# Every value that is one deployment's own. The caller reads them from its chat/chat.json.
variable "project" { type = string }
variable "project_number" { type = string }
variable "region" { type = string }
variable "domain" { type = string }
variable "site_id" { type = string }
variable "mcp_url" { type = string }
variable "origins" { type = list(string) }
variable "month_tokens" { type = number }
variable "proxy_hops" {
  type    = number
  default = 1
}
variable "image" {
  description = "The image to run, pushed by the same workflow run"
  type        = string
}
# Cloud Run gives a service the hashed form of its URL, which is not knowable before it exists,
# and the service's own environment needs it. Empty on a deployment's first apply; the check in
# run.tf then names it.
variable "run_host" {
  type    = string
  default = ""
}
# Which API answers: Vertex AI in this project, or the Anthropic API, with a key the owner put in
# the project's secret `chat-anthropic-key` or, when anthropic_federation is set, with the
# service's own identity and no secret at all. The secret, its version and the runtime's read
# access are the owner's, made before the deploy that mounts it.
variable "model_provider" {
  type    = string
  default = "vertex"
  validation {
    condition     = contains(["vertex", "anthropic"], var.model_provider)
    error_message = "model_provider is vertex or anthropic."
  }
}
# With the Anthropic API, the service trades its own Google identity for a token that lives
# minutes when the owner has made a federation rule for it, and reads the key from the project's
# secret when not. The ids are the rule's, the organization's and the Anthropic service
# account's, and none is a secret: only a token Google signs for this project's chat-run passes
# the rule. The workspace is needed only where the rule spans more than one.
variable "anthropic_federation" {
  type = object({
    rule_id            = string
    organization_id    = string
    service_account_id = string
    workspace_id       = optional(string)
  })
  default = null
  validation {
    condition     = var.anthropic_federation == null || var.model_provider == "anthropic"
    error_message = "anthropic_federation is for model_provider anthropic."
  }
}

# Where the Anthropic API runs a request: `global`, any geography it chooses, or `us`, the
# United States only. Unset, requests name none and the Console workspace's default decides.
variable "inference_geo" {
  type    = string
  default = null
  validation {
    condition     = var.inference_geo == null ? true : contains(["global", "us"], var.inference_geo)
    error_message = "inference_geo is global or us."
  }
  validation {
    condition     = var.inference_geo == null || var.model_provider == "anthropic"
    error_message = "inference_geo is for model_provider anthropic; on Vertex the region is the deployment's."
  }
}

# The answer check (docs/INTERFACE.md, the verdict event). Off by default, so a deployment that
# re-pins gains nothing it did not ask for. On, the module mounts the project's Secret Manager
# secret `typesafe-key`, which the owner makes as the README says, and passes the threshold the
# widget marks a claim above; with no threshold the widget marks nothing.
variable "verdict" {
  type    = bool
  default = false
}
variable "verdict_threshold" {
  type    = number
  default = null
  validation {
    # A conditional, since Terraform before 1.12 evaluates both sides of || and a null compared
    # with a number fails the plan.
    condition     = var.verdict_threshold == null ? true : var.verdict_threshold >= 0 && var.verdict_threshold <= 1
    error_message = "verdict_threshold is a probability between 0 and 1."
  }
}

# Readers who sign in at ZITADEL and choose the model. The service checks a token's issuer, the
# project it was issued for and the organization the reader belongs to; role_prefix narrows which
# roles count. chat.json's sign_in also holds the widget's client_id, which this object does not
# name and so drops: the service has no use for it. The reader secret is the owner's (run.tf).
variable "sign_in" {
  type = object({
    issuer      = string
    project_id  = string
    org_id      = string
    role_prefix = optional(string)
  })
  default = null
}
# What a signed-in reader may spend a month, beside month_tokens, which is the deployment's.
variable "user_month_tokens" {
  type    = number
  default = null
  validation {
    condition     = var.sign_in == null || var.user_month_tokens != null
    error_message = "user_month_tokens is required with sign_in."
  }
  validation {
    condition     = var.user_month_tokens == null ? true : var.user_month_tokens > 0 && var.user_month_tokens == floor(var.user_month_tokens)
    error_message = "user_month_tokens is a positive whole number."
  }
}
