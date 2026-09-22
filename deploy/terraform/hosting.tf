# Firebase Hosting in front of the service under the chat's own domain: a site of its own beside
# the MCP host's, one version rewriting every path to the service, uncacheable, its release and
# the domain. The Firebase project already exists from the host's module; it is read, not made.
resource "google_firebase_hosting_site" "this" {
  provider = google-beta
  project  = var.project
  site_id  = var.site_id
}

resource "google_firebase_hosting_version" "this" {
  provider = google-beta
  site_id  = google_firebase_hosting_site.this.site_id
  config {
    rewrites {
      glob = "**"
      run {
        service_id = google_cloud_run_v2_service.chat.name
        region     = google_cloud_run_v2_service.chat.location
      }
    }
    headers {
      glob    = "**"
      headers = { "Cache-Control" = "no-store" }
    }
  }
}

resource "google_firebase_hosting_release" "this" {
  provider     = google-beta
  site_id      = google_firebase_hosting_site.this.site_id
  version_name = google_firebase_hosting_version.this.name
  message      = "Every path rewritten to Cloud Run"
}

resource "google_firebase_hosting_custom_domain" "this" {
  provider              = google-beta
  project               = var.project
  site_id               = google_firebase_hosting_site.this.site_id
  custom_domain         = var.domain
  wait_dns_verification = false
}
