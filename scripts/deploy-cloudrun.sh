#!/usr/bin/env bash
set -euo pipefail

# Deploys the service to Google Cloud Run using Cloud Build and Artifact Registry.
# Prerequisites:
# - gcloud CLI installed and authenticated (gcloud auth login && gcloud auth application-default login)
# - Project set or provided via env var GCP_PROJECT_ID
# - Artifact Registry repo exists or will be created (requires permissions)

# Configuration (override via env vars)
PROJECT_ID=${PROJECT_ID:-}
REGION=${GCP_REGION:-us-central1}
SERVICE_NAME=${SERVICE_NAME:-knowsis-backend}
AR_REPO=${AR_REPO:-apps}
IMAGE_NAME=${IMAGE_NAME:-knowsis-backend}
IMAGE_TAG=${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}
PORT=${PORT:-3000}
CPU=${CLOUD_RUN_CPU:-1}
MEMORY=${CLOUD_RUN_MEMORY:-512Mi}
MAX_INSTANCES=${CLOUD_RUN_MAX_INSTANCES:-10}
MIN_INSTANCES=${CLOUD_RUN_MIN_INSTANCES:-0}
ALLOW_UNAUTH=${CLOUD_RUN_ALLOW_UNAUTH:-true}
SERVICE_ACCOUNT_EMAIL=${CLOUD_RUN_SA_EMAIL:-}
ENV_VARS_FILE=${ENV_VARS_FILE:-}

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: PROJECT_ID env var not set" >&2
  exit 1
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "Setting gcloud project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Enabling required APIs (run, artifactregistry, cloudbuild, cloudtasks)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com cloudtasks.googleapis.com >/dev/null

echo "Creating Artifact Registry repo if missing: ${AR_REPO} (${REGION})"
gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${AR_REPO}" \
  --repository-format=docker \
  --location "${REGION}" \
  --description "Docker images for ${PROJECT_ID}" >/dev/null

echo "Building and pushing image via Cloud Build: ${IMAGE_URI}"
gcloud builds submit --tag "${IMAGE_URI}" --quiet

DEPLOY_ARGS=(
  --image "${IMAGE_URI}"
  --region "${REGION}"
  --platform managed
  --port "${PORT}"
  --cpu "${CPU}"
  --memory "${MEMORY}"
  --max-instances "${MAX_INSTANCES}"
  --min-instances "${MIN_INSTANCES}"
  --set-env-vars NODE_ENV=production
)

if [[ -n "${SERVICE_ACCOUNT_EMAIL}" ]]; then
  DEPLOY_ARGS+=(--service-account "${SERVICE_ACCOUNT_EMAIL}")
fi

# Parse and include environment variables from .env.prod if it exists
if [[ -f ".env.prod" ]]; then
  echo "Loading environment variables from .env.prod"
  
  # Parse .env.prod and build comma-separated env vars string
  ENV_VARS_STRING=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    
    # Remove 'export ' prefix if present
    line="${line#export }"
    
    # Extract key=value, handling quotes properly
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      
      # Skip GOOGLE_APPLICATION_CREDENTIALS as it references a local file path
      [[ "$key" == "GOOGLE_APPLICATION_CREDENTIALS" ]] && continue
      
      # Remove surrounding quotes if present
      value="${value%\'}"
      value="${value#\'}"
      value="${value%\"}"
      value="${value#\"}"
      
      # Escape commas and equals in values by not including them if problematic
      # For Cloud Run, we need to be careful with special characters
      if [[ -n "$ENV_VARS_STRING" ]]; then
        ENV_VARS_STRING="${ENV_VARS_STRING},${key}=${value}"
      else
        ENV_VARS_STRING="${key}=${value}"
      fi
    fi
  done < .env.prod
  
  if [[ -n "$ENV_VARS_STRING" ]]; then
    DEPLOY_ARGS+=(--set-env-vars "^:^${ENV_VARS_STRING}")
  fi
elif [[ -n "${ENV_VARS_FILE}" ]]; then
  # Fallback to ENV_VARS_FILE if .env.prod doesn't exist
  # Expect a YAML/JSON env file compatible with Cloud Run (KEY: VALUE)
  DEPLOY_ARGS+=(--env-vars-file "${ENV_VARS_FILE}")
fi

if [[ "${ALLOW_UNAUTH}" == "true" ]]; then
  DEPLOY_ARGS+=(--allow-unauthenticated)
else
  DEPLOY_ARGS+=(--no-allow-unauthenticated)
fi

echo "Deploying to Cloud Run service: ${SERVICE_NAME}"
gcloud run deploy "${SERVICE_NAME}" "${DEPLOY_ARGS[@]}" --quiet

echo "Deployment complete. Service URL:"
gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)'


