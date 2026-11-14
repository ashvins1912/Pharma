variable "service_name" {
  type        = string
  description = "Service identifier from ServiceEnvironmentContract.metadata.name"
}

variable "environment" {
  type        = string
  description = "Target environment (local, dev, staging, prod, ephemeral)"
}

variable "owner" {
  type = string
}

variable "cost_center" {
  type = string
}

variable "provider_name" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "private_subnets_only" {
  type    = bool
  default = true
}

variable "kms_cmk_rotation" {
  type    = bool
  default = true
}

variable "compute_instance_family" {
  type = string
}

variable "compute_node_count" {
  type = number
}

variable "db_enabled" {
  type    = bool
  default = false
}

variable "db_tier" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_storage_gb" {
  type    = number
  default = 50
}

variable "cache_tier" {
  type    = string
  default = ""
}

variable "queue_enabled" {
  type    = bool
  default = false
}

variable "object_storage_encrypted" {
  type    = bool
  default = false
}

variable "compliance_tier" {
  type    = string
  default = "standard"
}
