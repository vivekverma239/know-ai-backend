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
# gcloud config set project "${PROJECT_ID}" >/dev/null

# echo "Enabling required APIs (run, artifactregistry, cloudbuild, cloudtasks)"
# gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com cloudtasks.googleapis.com >/dev/null

# echo "Creating Artifact Registry repo if missing: ${AR_REPO} (${REGION})"
# gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1 || \
# gcloud artifacts repositories create "${AR_REPO}" \
#   --repository-format=docker \
#   --location "${REGION}" \
#   --description "Docker images for ${PROJECT_ID}" >/dev/null

# echo "Building and pushing image via Cloud Build: ${IMAGE_URI}"
# gcloud builds submit --tag "${IMAGE_URI}" --quiet

DEPLOY_ARGS=(
  --image "${IMAGE_URI}"
  --region "${REGION}"
  --platform managed
  --port "${PORT}"
  --cpu "${CPU}"
  --memory "${MEMORY}"
  --max-instances "${MAX_INSTANCES}"
  --min-instances "${MIN_INSTANCES}"
)

if [[ -n "${SERVICE_ACCOUNT_EMAIL}" ]]; then
  DEPLOY_ARGS+=(--service-account "${SERVICE_ACCOUNT_EMAIL}")
fi




# Always include computed identifiers
DEPLOY_ARGS+=(--set-env-vars GCLOUD_PROJECT="${PROJECT_ID}")
DEPLOY_ARGS+=(--set-env-vars PROJECT_ID="${PROJECT_ID}")
DEPLOY_ARGS+=(--set-env-vars REGION="${REGION}")

# Default NODE_ENV if not set in env or file
DEFAULT_NODE_ENV="${NODE_ENV:-production}"

# Parse and include from .env.prod if present
if [[ -f ".env.prod" ]]; then
  echo "Loading environment variables from .env.prod"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#export }"
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      [[ "$key" == "GOOGLE_APPLICATION_CREDENTIALS" ]] && continue
      [[ "$key" == "PROJECT_ID" ]] && continue
      [[ "$key" == "REGION" ]] && continue


      value="${value%\'}"; value="${value#\'}"; value="${value%\"}"; value="${value#\"}"
      DEPLOY_ARGS+=(--set-env-vars "${key}=${value}")
    fi
  done < .env.prod
else
  if [[ -n "${ENV_VARS_FILE}" ]]; then
    DEPLOY_ARGS+=(--env-vars-file "${ENV_VARS_FILE}")
  fi
fi



# Ensure NODE_ENV present if not added yet from file
if ! printf '%s\n' "${DEPLOY_ARGS[@]}" | grep -q "--set-env-vars NODE_ENV="; then
  DEPLOY_ARGS+=(--set-env-vars NODE_ENV="${DEFAULT_NODE_ENV}")
fi


echo "DEPLOY_ARGS: ${DEPLOY_ARGS[@]}" > deploy-cloudrun.log



echo "Deploying to Cloud Run service: ${SERVICE_NAME}"
gcloud run deploy "${SERVICE_NAME}" "${DEPLOY_ARGS[@]}" --quiet --allow-unauthenticated

echo "Deployment complete. Service URL:"
gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)'


