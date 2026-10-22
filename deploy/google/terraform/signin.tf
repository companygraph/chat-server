# A signed-in reader: the service verifies a ZITADEL token and mints its own short session for the
# reader, signed with a secret only the service and this state hold. The secret is made here, not
# by the owner, because nothing outside the deployment ever needs its value; it exists only when
# the deployment signs readers in, and rotating it is a taint of the password and an apply.
resource "random_password" "reader_secret" {
  count   = var.sign_in == null ? 0 : 1
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "reader_secret" {
  count     = var.sign_in == null ? 0 : 1
  secret_id = "chat-reader-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.chat]
}

resource "google_secret_manager_secret_version" "reader_secret" {
  count       = var.sign_in == null ? 0 : 1
  secret      = google_secret_manager_secret.reader_secret[0].id
  secret_data = random_password.reader_secret[0].result
}

# Access to this one secret, not to the project's: the runtime reads nothing else in Secret Manager
# through this module.
resource "google_secret_manager_secret_iam_member" "reader_secret" {
  count     = var.sign_in == null ? 0 : 1
  secret_id = google_secret_manager_secret.reader_secret[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.chat.email}"
}
