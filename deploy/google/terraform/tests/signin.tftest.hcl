# Sign-in as a deployment calls it: providers mocked, nothing reached. The plan evaluates the
# variables' own validation, which `terraform validate` never does.
mock_provider "google" {}
mock_provider "google-beta" {}
mock_provider "random" {}

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
  assert {
    condition     = length(google_secret_manager_secret.reader_secret) == 1
    error_message = "sign_in makes the reader secret."
  }
}

run "no_sign_in_makes_no_secret" {
  command         = plan
  expect_failures = [check.run_host]
  assert {
    condition     = length(google_secret_manager_secret.reader_secret) == 0
    error_message = "without sign_in there is no reader secret."
  }
}
