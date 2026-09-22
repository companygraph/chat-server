# The service, and the identity of its own that holds exactly the two roles the chat needs: to
# call the model and to keep the meter. The MCP host's runtime keeps holding none.
resource "google_service_account" "chat" {
  account_id   = "chat-run"
  display_name = "Runtime of the chat service"
  depends_on   = [google_project_service.chat]
}

resource "google_project_iam_member" "chat" {
  for_each = toset(["roles/aiplatform.user", "roles/datastore.user"])
  project  = var.project
  role     = each.value
  member   = "serviceAccount:${google_service_account.chat.email}"
}

locals {
  run_host = var.run_host
}

resource "google_cloud_run_v2_service" "chat" {
  name                = "chat"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.chat.email
    max_instance_request_concurrency = 20
    # A message is at most five model calls of sixty seconds each, and a request cut off part way
    # through one is a visitor left with half an answer.
    timeout = "300s"
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "CHAT_MCP_URL"
        value = var.mcp_url
      }
      env {
        name  = "CHAT_ORIGINS"
        value = join(",", var.origins)
      }
      env {
        name  = "CHAT_HOSTS"
        value = join(",", compact([var.domain, local.run_host]))
      }
      env {
        name  = "CHAT_MONTH_TOKENS"
        value = tostring(var.month_tokens)
      }
      env {
        name  = "CHAT_PROJECT"
        value = var.project
      }
      # The Vertex endpoint, not the region the service runs in: the design puts the model on the
      # Europe multi-region, which var.region names no part of, and the two differ on purpose. It
      # becomes an input of its own the day a deployment needs another endpoint.
      env {
        name  = "CHAT_REGION"
        value = "eu"
      }
      env {
        name  = "CHAT_PROXY_HOPS"
        value = tostring(var.proxy_hops)
      }
      # With the Anthropic API, the key rides in from the project's secret, latest version. The
      # secret is the owner's: the module neither makes it nor grants access to it, so a deploy
      # that mounts it before the owner's three commands fails at Cloud Run's own check, by name.
      dynamic "env" {
        for_each = var.model_provider == "anthropic" ? [1] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = "chat-anthropic-key"
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_service.chat, google_firestore_database.meter, google_project_iam_member.chat]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.chat.name
  location = google_cloud_run_v2_service.chat.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

check "run_host" {
  assert {
    condition     = google_cloud_run_v2_service.chat.uri == "https://${local.run_host}"
    error_message = "The service's URI is not the run_host in CHAT_HOSTS; a request on the run.app address will be refused until chat.json names the host this URI carries as run_host."
  }
}
