# Sign-in as a deployment calls it: providers mocked, nothing reached. The plan evaluates the
# variables' own validation, which `terraform validate` never does.
mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project        = "example-project"
  project_number = "123456789012"
  region         = "europe-west6"
  domain         = "chat.example.test"
  site_id        = "chat-example-test"
  mcp_url        = "https://mcp.example.test/mcp"
  origins        = ["https://example.test"]
  month_tokens   = 1000000
  run_host       = "chat-example-oa.a.run.app"
  image          = "europe-west6-docker.pkg.dev/example-project/mcp/chat:test"
}

run "sign_in_without_user_month_is_refused" {
  command         = plan
  expect_failures = [var.user_month_tokens]
  variables {
    sign_in = { issuer = "https://id.example.test", project_id = "1", org_id = "2" }
  }
}

run "sign_in_with_user_month_plans" {
  command         = plan
  expect_failures = [check.run_host]
  variables {
    sign_in           = { issuer = "https://id.example.test", project_id = "1", org_id = "2" }
    user_month_tokens = 2000000
  }
  # The secret is the owner's: the service mounts it by name, latest version, and the module makes
  # none, so the plan holds no resource of Secret Manager to assert on.
  assert {
    condition = [
      for e in google_cloud_run_v2_service.chat.template[0].containers[0].env :
      [e.value_source[0].secret_key_ref[0].secret, e.value_source[0].secret_key_ref[0].version]
      if e.name == "CHAT_READER_SECRET"
    ] == [["chat-reader-secret", "latest"]]
    error_message = "sign_in mounts CHAT_READER_SECRET from chat-reader-secret, latest version."
  }
}

run "no_sign_in_mounts_no_secret" {
  command         = plan
  expect_failures = [check.run_host]
  assert {
    condition     = length([for e in google_cloud_run_v2_service.chat.template[0].containers[0].env : e if e.name == "CHAT_READER_SECRET"]) == 0
    error_message = "without sign_in there is no CHAT_READER_SECRET."
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
