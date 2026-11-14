terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Workspace / environment prefix isolation with state locking
  backend "s3" {
    bucket         = "devops-kit-tfstate-global"
    key            = "services/service.tfstate"
    region         = "us-east-1"
    dynamodb_table = "devops-kit-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Service        = var.service_name
      Environment    = var.environment
      Owner          = var.owner
      CostCenter     = var.cost_center
      ComplianceTier = var.compliance_tier
      ManagedBy      = "devops-kit"
    }
  }
}

resource "aws_kms_key" "service_cmk" {
  description             = "KMS CMK for ${var.service_name}-${var.environment}"
  enable_key_rotation     = var.kms_cmk_rotation
  deletion_window_in_days = var.environment == "prod" ? 30 : 7
}

resource "aws_vpc" "service_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.service_name}-${var.environment}-vpc"
  }
}

resource "random_password" "db_master" {
  count   = var.db_enabled ? 1 : 0
  length  = 28
  special = false
}

resource "aws_db_instance" "primary" {
  count                   = var.db_enabled ? 1 : 0
  identifier              = "${var.service_name}-${var.environment}-pg"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = var.db_tier
  allocated_storage       = var.db_storage_gb
  multi_az                = var.db_multi_az
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.service_cmk.arn
  publicly_accessible     = !var.private_subnets_only
  skip_final_snapshot     = var.environment != "prod"
  username                = "app_user"
  password                = random_password.db_master[0].result
  backup_retention_period = var.environment == "prod" ? 14 : 1
}

resource "aws_s3_bucket" "artifacts" {
  count  = var.object_storage_encrypted ? 1 : 0
  bucket = "${var.service_name}-${var.environment}-${var.region}-artifacts"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts_sse" {
  count  = var.object_storage_encrypted ? 1 : 0
  bucket = aws_s3_bucket.artifacts[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.service_cmk.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts_block" {
  count                   = var.object_storage_encrypted ? 1 : 0
  bucket                  = aws_s3_bucket.artifacts[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Automated Output Export -> Centralized Parameter / Secret Store
resource "aws_ssm_parameter" "db_url" {
  count = var.db_enabled ? 1 : 0
  name  = "/devops-kit/${var.environment}/${var.service_name}/DATABASE_URL"
  type  = "SecureString"
  key_id = aws_kms_key.service_cmk.arn
  value = "postgresql://app_user:${random_password.db_master[0].result}@${aws_db_instance.primary[0].endpoint}/${var.service_name}?sslmode=require"
}

resource "aws_ssm_parameter" "s3_bucket" {
  count = var.object_storage_encrypted ? 1 : 0
  name  = "/devops-kit/${var.environment}/${var.service_name}/S3_BUCKET_NAME"
  type  = "String"
  value = aws_s3_bucket.artifacts[0].bucket
}
