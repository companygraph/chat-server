# The kept questions, ninety days. The analyst holds the only grant made for this workspace, but
# the pull-request plan identity's Reader on the resource group very likely reads it as well,
# which piece 3 confirms and narrows. Azure cannot fork one log stream into two tables, so the
# environment's console lines reach a workspace of the chat's own through a second diagnostic
# setting, and a transformation on each workspace decides what stays: the chat's workspace keeps
# the chat's question lines and nothing else, and the environment's general workspace keeps
# everything but them, so a question exists in one place with one retention, as the Google sink
# and its exclusion ensure. A workspace names its transformation and the transformation names its
# workspace, so the link is made by azapi after both exist.
locals {
  question  = "ContainerAppName == 'chat' and tostring(parse_json(Log).kind) == 'question'"
  transform = "Microsoft-Table-ContainerAppConsoleLogs"
}

resource "azurerm_log_analytics_workspace" "questions" {
  name                = "chat-questions"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  lifecycle {
    ignore_changes = [data_collection_rule_id]
  }
}

resource "azurerm_monitor_diagnostic_setting" "questions" {
  name                       = "chat-questions"
  target_resource_id         = data.azurerm_container_app_environment.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.questions.id
  enabled_log { category = "ContainerAppConsoleLogs" }
}

resource "azurerm_monitor_data_collection_rule" "questions" {
  name                = "chat-questions-keep"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  kind                = "WorkspaceTransforms"
  destinations {
    log_analytics {
      name                  = "questions"
      workspace_resource_id = azurerm_log_analytics_workspace.questions.id
    }
  }
  data_flow {
    streams       = [local.transform]
    destinations  = ["questions"]
    transform_kql = "source | where ${local.question}"
  }
}

resource "azapi_update_resource" "questions" {
  type        = "Microsoft.OperationalInsights/workspaces@2022-10-01"
  resource_id = azurerm_log_analytics_workspace.questions.id
  body = {
    properties = {
      defaultDataCollectionRuleResourceId = azurerm_monitor_data_collection_rule.questions.id
    }
  }
}

resource "azurerm_monitor_data_collection_rule" "logs" {
  name                = "logs-without-questions"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  kind                = "WorkspaceTransforms"
  destinations {
    log_analytics {
      name                  = "logs"
      workspace_resource_id = data.azurerm_log_analytics_workspace.logs.id
    }
  }
  data_flow {
    streams       = [local.transform]
    destinations  = ["logs"]
    transform_kql = "source | where not(${local.question})"
  }
}

resource "azapi_update_resource" "logs" {
  type        = "Microsoft.OperationalInsights/workspaces@2022-10-01"
  resource_id = data.azurerm_log_analytics_workspace.logs.id
  body = {
    properties = {
      defaultDataCollectionRuleResourceId = azurerm_monitor_data_collection_rule.logs.id
    }
  }
}

# The weekly report's files, deleted on the eighty-fourth day, so a question quoted in a report is
# gone ninety days after it was asked and the promise has one number.
resource "azurerm_storage_container" "reports" {
  name                  = "reports"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "reports" {
  storage_account_id = azurerm_storage_account.this.id
  rule {
    name    = "reports-83-days"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["reports/"]
    }
    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = 83
      }
    }
  }
}

# The reader: the repository's runs on main, for the weekly report, and nothing more than the
# questions' workspace and the reports' container. The owner's own reading is granted by hand.
resource "azurerm_user_assigned_identity" "analyst" {
  name                = "chat-analyst"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_federated_identity_credential" "analyst" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.analyst.id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = "repo:${split("/", var.repository)[0]}@${var.owner_id}/${split("/", var.repository)[1]}@${var.repository_id}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "analyst_questions" {
  scope                = azurerm_log_analytics_workspace.questions.id
  role_definition_name = "Log Analytics Data Reader"
  principal_id         = azurerm_user_assigned_identity.analyst.principal_id
}

resource "azurerm_role_assignment" "analyst_reports" {
  scope                = azurerm_storage_container.reports.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.analyst.principal_id
}
