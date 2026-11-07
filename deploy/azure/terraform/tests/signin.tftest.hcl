# Sign-in as a deployment calls it: providers mocked, nothing reached. The plan evaluates the
# variables' own validation, which `terraform validate` never does. The vault's address and the
# app identity's id are known only once they exist, so the runs assert what a plan knows.
# azurerm checks the form of an id it is handed, so every id a data source gives is one of the
# form it expects; a resource the module makes takes a mocked id of the same form.
mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = { tenant_id = "00000000-0000-0000-0000-000000000003" }
  }
  mock_data "azurerm_resource_group" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000004/resourceGroups/example", location = "switzerlandnorth" }
  }
  mock_data "azurerm_container_registry" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000004/resourceGroups/example/providers/Microsoft.ContainerRegistry/registries/example", login_server = "example.azurecr.io" }
  }
  mock_data "azurerm_container_app_environment" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000004/resourceGroups/example/providers/Microsoft.App/managedEnvironments/apps" }
  }
  mock_data "azurerm_log_analytics_workspace" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000004/resourceGroups/example/providers/Microsoft.OperationalInsights/workspaces/logs" }
  }
}
mock_provider "azapi" {}

variables {
  resource_group_name = "example"
  registry_name       = "example"
  domain              = "chat.example.test"
  mcp_url             = "https://mcp.example.test/mcp"
  origins             = ["https://example.test"]
  month_tokens        = 1000000
  storage_account     = "chatexample"
  image               = "example.azurecr.io/chat:test"
  app_host            = "chat.example.switzerlandnorth.azurecontainerapps.io"
  repository          = "example/example"
  repository_id       = "1"
  owner_id            = "2"
  anthropic_federation = {
    rule_id            = "fdrl_example"
    organization_id    = "00000000-0000-0000-0000-000000000001"
    service_account_id = "svac_example"
    audience           = "00000000-0000-0000-0000-000000000002"
  }
}

run "sign_in_without_user_month_is_refused" {
  command         = plan
  expect_failures = [var.user_month_tokens]
  variables {
    sign_in = { issuer = "https://id.example.test", project_id = "1", org_id = "2" }
  }
}

run "sign_in_with_user_month_reads_the_vault" {
  command         = plan
  expect_failures = [check.app_host]
  variables {
    sign_in           = { issuer = "https://id.example.test", project_id = "1", org_id = "2" }
    user_month_tokens = 2000000
  }
  assert {
    condition     = [for s in azurerm_container_app.chat.secret : s.name if s.value == null] == ["chat-reader-secret"]
    error_message = "sign_in gives the app one secret, chat-reader-secret, by reference and with no value of its own."
  }
  assert {
    condition     = [for e in azurerm_container_app.chat.template[0].container[0].env : e.secret_name if e.name == "CHAT_READER_SECRET"] == ["chat-reader-secret"]
    error_message = "sign_in hands the app CHAT_READER_SECRET from the secret chat-reader-secret."
  }
  assert {
    condition     = one([for e in azurerm_container_app.chat.template[0].container[0].env : e.value if e.name == "CHAT_OIDC_ISSUER"]) == "https://id.example.test"
    error_message = "sign_in names the issuer to the service."
  }
}

run "no_sign_in_reads_no_secret_but_keeps_the_vault" {
  command         = plan
  expect_failures = [check.app_host]
  assert {
    condition     = length(azurerm_container_app.chat.secret) == 0 && length([for e in azurerm_container_app.chat.template[0].container[0].env : e if startswith(e.name, "CHAT_OIDC") || e.name == "CHAT_READER_SECRET"]) == 0
    error_message = "without sign_in the app has no secret and no sign-in variable."
  }
  assert {
    condition     = one([for e in azurerm_container_app.chat.template[0].container[0].env : e.value if e.name == "CHAT_PROXY_HOPS"]) == "0"
    error_message = "the service reads the last X-Forwarded-For entry, the one Container Apps' ingress appends."
  }
  assert {
    condition     = azurerm_key_vault.this.name == "chatexample" && azurerm_key_vault.this.rbac_authorization_enabled
    error_message = "the vault exists without sign_in, under the storage account's name, with access by role."
  }
}

run "user_month_must_be_positive_whole" {
  command         = plan
  expect_failures = [var.user_month_tokens]
  variables {
    sign_in           = { issuer = "https://id.example.test", project_id = "1", org_id = "2" }
    user_month_tokens = 1.5
  }
}
