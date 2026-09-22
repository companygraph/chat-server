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
# Which API answers: Vertex AI in this project, or the Anthropic API with the key the owner put
# in the project's secret `chat-anthropic-key`. The secret, its version and the runtime's read
# access are the owner's, made before the deploy that mounts it.
variable "model_provider" {
  type    = string
  default = "vertex"
  validation {
    condition     = contains(["vertex", "anthropic"], var.model_provider)
    error_message = "model_provider is vertex or anthropic."
  }
}
