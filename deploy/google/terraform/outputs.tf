output "service_url" { value = google_cloud_run_v2_service.chat.uri }
output "run_host" { value = local.run_host }
output "hosting_url" { value = google_firebase_hosting_site.this.default_url }
output "dns_records" {
  description = "What the domain needs; create these at the DNS provider of the deployment's domain"
  value       = google_firebase_hosting_custom_domain.this.required_dns_updates
}
output "analyst_email" { value = google_service_account.analyst.email }
output "questions_view" { value = local.questions_view }
output "reports_bucket" { value = google_storage_bucket.reports.name }
