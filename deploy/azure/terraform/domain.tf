# The domain in three steps, as the MCP host's module adds its own: the host name added unbound,
# a free certificate issued against a CNAME that points straight at the app, and one PATCH of the
# app's custom domains binding them, since azurerm cannot (terraform-provider-azurerm#27362).
resource "azurerm_container_app_custom_domain" "this" {
  count            = var.dns_ready ? 1 : 0
  name             = var.domain
  container_app_id = azurerm_container_app.chat.id
  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "this" {
  count                        = var.dns_ready ? 1 : 0
  name                         = "chat"
  container_app_environment_id = data.azurerm_container_app_environment.this.id
  subject_name                 = var.domain
  domain_control_validation    = "CNAME"
  depends_on                   = [azurerm_container_app_custom_domain.this]
}

resource "azapi_resource_action" "bind" {
  count       = var.dns_ready ? 1 : 0
  type        = "Microsoft.App/containerApps@2025-07-01"
  resource_id = azurerm_container_app.chat.id
  method      = "PATCH"
  body = {
    properties = {
      configuration = {
        ingress = {
          customDomains = [{
            name          = var.domain
            bindingType   = "SniEnabled"
            certificateId = azurerm_container_app_environment_managed_certificate.this[0].id
          }]
        }
      }
    }
  }
}
