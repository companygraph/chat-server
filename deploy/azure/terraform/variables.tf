# Every value that is one deployment's own. The caller reads them from its deployment.json and
# its chat/chat.json.
variable "resource_group_name" { type = string }
variable "registry_name" { type = string }
variable "domain" { type = string }
variable "mcp_url" { type = string }
variable "origins" { type = list(string) }
variable "month_tokens" { type = number }
# Container Apps' ingress appends one address, the client's, to X-Forwarded-For.
variable "proxy_hops" {
  type    = number
  default = 1
}
variable "image" {
  description = "The image to run, pushed by the same workflow run"
  type        = string
}
# The storage account holding the meter's table and the reports; its name is global across
# Azure, so the deployment chooses it.
variable "storage_account" { type = string }
# As in the MCP host's module: the generated host name, empty on the first apply, and the domain
# added only once its two records are set.
variable "app_host" {
  type    = string
  default = ""
}
variable "dns_ready" {
  type    = bool
  default = false
}
# On Azure the chat reaches the Anthropic API through workload identity federation alone: its
# managed identity asks for a token for the tenant's app registration standing for the Claude API,
# api://<audience>, and trades it. The ids are the rule's, the organization's and the Anthropic
# service account's, and none is a secret.
variable "anthropic_federation" {
  type = object({
    rule_id            = string
    organization_id    = string
    service_account_id = string
    audience           = string
    workspace_id       = optional(string)
  })
}
# The repository whose runs on main write the weekly report, by the ids GitHub's immutable
# subject carries, as the bootstrap names them.
# Where the Anthropic API runs a request: `global`, any geography it chooses, or `us`, the
# United States only. Unset, requests name none and the Console workspace's default decides.
variable "inference_geo" {
  type    = string
  default = null
  validation {
    condition     = var.inference_geo == null ? true : contains(["global", "us"], var.inference_geo)
    error_message = "inference_geo is global or us."
  }
}
variable "repository" { type = string }
variable "repository_id" { type = string }
variable "owner_id" { type = string }

# Readers who sign in at ZITADEL and choose the model, as on Google: the service checks a token's
# issuer, the project it was issued for and the organization the reader belongs to; role_prefix
# narrows which roles count. chat.json's sign_in also holds the widget's client_id, which this
# object does not name and so drops. The reader secret is the owner's, in the key vault (signin.tf).
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
