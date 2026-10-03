output "service_url" { value = "https://${azurerm_container_app.chat.ingress[0].fqdn}" }
output "app_host" { value = azurerm_container_app.chat.ingress[0].fqdn }
output "dns_records" {
  description = "What the domain needs before dns_ready; create these at the DNS provider of the deployment's domain"
  value = [
    { name = var.domain, type = "CNAME", value = azurerm_container_app.chat.ingress[0].fqdn },
    { name = "asuid.${var.domain}", type = "TXT", value = azurerm_container_app.chat.custom_domain_verification_id },
  ]
}
output "run_principal_id" { value = azurerm_user_assigned_identity.run.principal_id }
output "analyst_client_id" { value = azurerm_user_assigned_identity.analyst.client_id }
output "questions_workspace_id" { value = azurerm_log_analytics_workspace.questions.workspace_id }
output "reports_url" { value = "${azurerm_storage_account.this.primary_blob_endpoint}reports" }
