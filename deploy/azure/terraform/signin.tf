# The reader secret keys a signed-in reader's month: the row of the partition `readers` is named
# by the HMAC-SHA256 of the token's sub under it, so the meter holds nothing the identity service
# would recognize, and rotating it gives every reader a fresh month. The secret is the owner's, as
# on Google: the module makes the vault and lets the service read it, and the owner adds the
# secret by hand, as the README's owner's steps say, so its value is in no file and no state.
#
# The vault exists with or without sign_in, so a deployment applies it once before it names
# sign_in, and the owner has a vault to put the secret into before the app asks for it. It takes
# the storage account's name, which the deployment already chose to be free across Azure.
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                       = var.storage_account
  location                   = data.azurerm_resource_group.this.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
}

resource "azurerm_role_assignment" "reader_secret" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

locals {
  reader_secret_name = "chat-reader-secret"
  sign_in_env = var.sign_in == null ? {} : {
    for k, v in {
      CHAT_OIDC_ISSUER       = var.sign_in.issuer
      CHAT_OIDC_PROJECT      = var.sign_in.project_id
      CHAT_OIDC_ORG          = var.sign_in.org_id
      CHAT_USER_MONTH_TOKENS = tostring(var.user_month_tokens)
      CHAT_OIDC_ROLE_PREFIX  = var.sign_in.role_prefix
    } : k => v if v != null
  }
}
