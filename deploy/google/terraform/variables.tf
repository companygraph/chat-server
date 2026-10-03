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
