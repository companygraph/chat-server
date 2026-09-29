# The service, and the identity of its own that may pull its image, keep the meter and ask for the
# token it trades at Anthropic, and nothing else.
resource "azurerm_user_assigned_identity" "run" {
  name                = "chat-run"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_role_assignment" "pull" {
  scope                = data.azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

# The meter's one entity and the weekly reports, in one account reached with Entra ID alone.
resource "azurerm_storage_account" "this" {
  name                            = var.storage_account
  resource_group_name             = var.resource_group_name
  location                        = data.azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_table" "meter" {
  name               = "chat"
  storage_account_id = azurerm_storage_account.this.id
}

resource "azurerm_role_assignment" "meter" {
  scope                = azurerm_storage_table.meter.resource_manager_id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

locals {
  app_host = var.app_host
  # The SDK's own names, so the environment reads the same to anyone who knows the SDK.
  federation_env = {
    for k, v in {
      ANTHROPIC_FEDERATION_RULE_ID = var.anthropic_federation.rule_id
      ANTHROPIC_ORGANIZATION_ID    = var.anthropic_federation.organization_id
      ANTHROPIC_SERVICE_ACCOUNT_ID = var.anthropic_federation.service_account_id
      ANTHROPIC_WORKSPACE_ID       = var.anthropic_federation.workspace_id
    } : k => v if v != null
  }
  env = merge(local.federation_env, {
    CHAT_MCP_URL           = var.mcp_url
    CHAT_ORIGINS           = join(",", var.origins)
    CHAT_HOSTS             = join(",", compact([var.domain, local.app_host]))
    CHAT_MONTH_TOKENS      = tostring(var.month_tokens)
    CHAT_PROXY_HOPS        = tostring(var.proxy_hops)
    CHAT_METER             = "table"
    CHAT_TABLE_URL         = azurerm_storage_account.this.primary_table_endpoint
    CHAT_IDENTITY          = "azure"
    CHAT_IDENTITY_AUDIENCE = "api://${var.anthropic_federation.audience}"
    CHAT_LOG               = "plain"
    AZURE_CLIENT_ID        = azurerm_user_assigned_identity.run.client_id
  })
}

resource "azurerm_container_app" "chat" {
  name                         = "chat"
  container_app_environment_id = data.azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.run.id]
  }

  registry {
    server   = data.azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.run.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 3
    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
    container {
      name   = "chat"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"
      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.pull, azurerm_role_assignment.meter]
}

check "app_host" {
  assert {
    condition     = azurerm_container_app.chat.ingress[0].fqdn == local.app_host
    error_message = "The app's host name is not the app_host in CHAT_HOSTS; a request on that name will be refused until chat.json names the host this app carries as app_host."
  }
}
