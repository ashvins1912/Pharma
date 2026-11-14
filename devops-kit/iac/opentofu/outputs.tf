output "vpc_id" {
  value = aws_vpc.service_vpc.id
}

output "kms_key_arn" {
  value = aws_kms_key.service_cmk.arn
}

output "db_endpoint" {
  value     = var.db_enabled ? aws_db_instance.primary[0].endpoint : null
  sensitive = false
}

output "s3_bucket_name" {
  value = var.object_storage_encrypted ? aws_s3_bucket.artifacts[0].bucket : null
}
