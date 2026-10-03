# The resources every deployment of the chat runs on Azure, beside the MCP host's in the same
# resource group and in its Container Apps environment. The caller holds the backend and the
# providers; this module holds what the service is.
terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 5.7" }
    azapi   = { source = "Azure/azapi", version = "~> 2.13" }
  }
}

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = var.resource_group_name
}

# Made by the MCP host's module, under the names it gives them.
data "azurerm_container_app_environment" "this" {
  name                = "apps"
  resource_group_name = var.resource_group_name
}

data "azurerm_log_analytics_workspace" "logs" {
  name                = "logs"
  resource_group_name = var.resource_group_name
}
