# What the chat keeps of a question, and who may read it. The route writes one line per question
# to standard output; the sink routes those lines, and only those, into a bucket of their own
# with the retention the privacy pages state, and the exclusion, on the same filter, keeps the
# default bucket from holding a second copy under another retention. The view over the bucket
# exists so that a grant can name it: the bucket holds nothing but questions.
locals {
  questions_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.chat.name}\" AND jsonPayload.kind=\"question\""
  questions_view   = "${google_logging_project_bucket_config.questions.id}/views/${google_logging_log_view.questions.name}"
  main_runs        = "principalSet://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/github/attribute.ref/refs/heads/main"
}

resource "google_logging_project_bucket_config" "questions" {
  project        = var.project
  location       = var.region
  bucket_id      = "chat-questions"
  retention_days = 90
  description    = "One line per question the chat was asked, kept ninety days"
  depends_on     = [google_project_service.chat]
}

resource "google_logging_log_view" "questions" {
  name        = "questions"
  bucket      = google_logging_project_bucket_config.questions.id
  description = "The questions, and nothing else in the project"
}

resource "google_logging_project_sink" "questions" {
  project                = var.project
  name                   = "chat-questions"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.questions.id}"
  filter                 = local.questions_filter
  unique_writer_identity = true
}

# Depends on the sink so an apply never opens a window where the exclusion already drops entries
# from _Default while the sink does not yet exist to carry them into the bucket instead.
resource "google_logging_project_exclusion" "questions" {
  project     = var.project
  name        = "chat-questions"
  description = "The questions live in their own bucket, under their own retention"
  filter      = local.questions_filter
  depends_on  = [google_logging_project_sink.questions]
}

# The reader: one account holding the view and the reports bucket and nothing else, not the
# request log with its addresses, not the meter, not the service. The repository's runs on main
# act as it for the weekly report, through the pool the bootstrap made; the owner's login is
# granted impersonation by hand, since the login's address belongs in no repository.
resource "google_service_account" "analyst" {
  account_id   = "chat-analyst"
  display_name = "Reader of the chat's questions and reports"
  depends_on   = [google_project_service.chat]
}

resource "google_project_iam_member" "analyst_view" {
  project = var.project
  role    = "roles/logging.viewAccessor"
  member  = "serviceAccount:${google_service_account.analyst.email}"
  condition {
    title      = "the questions view"
    expression = "resource.name == \"${local.questions_view}\""
  }
}

resource "google_service_account_iam_member" "analyst_wif" {
  service_account_id = google_service_account.analyst.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.main_runs
}

# The reports: private, in the region, and gone at eighty-three days with no soft-delete
# retention, since a report quotes questions up to a week old, so a question quoted in a report
# is gone ninety days after it was asked and the promise has one number.
resource "google_storage_bucket" "reports" {
  project                     = var.project
  name                        = "chat-reports-${var.project}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  soft_delete_policy {
    retention_duration_seconds = 0
  }
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 83
    }
  }
  depends_on = [google_project_service.chat]
}

resource "google_storage_bucket_iam_member" "analyst_reports" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.analyst.email}"
}
