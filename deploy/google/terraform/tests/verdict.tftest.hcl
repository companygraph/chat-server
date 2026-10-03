# The module planned as a deployment calls it, with providers mocked so no cloud is reached. A
# plan evaluates each variable's own validation, which `terraform validate` never does: that is
# how a check of verdict_threshold that refused null shipped in v0.23.0.
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
  model_provider = "anthropic"
  run_host       = "chat-example-oa.a.run.app"
  image          = "europe-west6-docker.pkg.dev/example-project/mcp/chat:test"
}

# The check on with no threshold plans.
run "check_on_without_threshold" {
  command = plan
  # The service's URL is Cloud Run's to give at apply, so the run_host check cannot be decided
  # by a plan; every other check and validation is.
  expect_failures = [check.run_host]
  variables {
    verdict           = true
    verdict_threshold = null
  }
}

# The check off plans, as for every deployment that never names it.
run "check_off" {
  command         = plan
  expect_failures = [check.run_host]
}

# A threshold outside 0 to 1 is refused.
run "threshold_out_of_range" {
  command = plan
  variables {
    verdict           = true
    verdict_threshold = 2
  }
  expect_failures = [var.verdict_threshold]
}
