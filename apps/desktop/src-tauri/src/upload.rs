use serde::Deserialize;
use std::time::Duration;

/// A wedged or unreachable API must surface as a failed share, not a panel
/// stuck on "Uploading…" with the Capture button disabled.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
pub struct CreateShotResponse {
    pub shot: ShotPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotPayload {
    pub id: String,
    pub viewer_url: Option<String>,
    pub viewer_path: String,
    pub expires_at: String,
}

pub async fn upload_png(
    api_base: &str,
    device_id: &str,
    png: Vec<u8>,
) -> Result<CreateShotResponse, UploadError> {
    let url = format!("{}/v1/shots", api_base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(UPLOAD_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| UploadError::Network(e.to_string()))?;
    let res = client
        .post(&url)
        .header("X-HauntShot-Device-Id", device_id)
        .header("Content-Type", "image/png")
        .body(png)
        .send()
        .await
        .map_err(network_error)?;

    let status = res.status();
    let body = res.text().await.map_err(network_error)?;

    if status.as_u16() == 402 {
        return Err(UploadError::QuotaExceeded);
    }
    if !status.is_success() {
        return Err(UploadError::Api {
            status: status.as_u16(),
            body,
        });
    }

    serde_json::from_str(&body).map_err(|e| UploadError::Api {
        status: status.as_u16(),
        body: format!("Invalid JSON ({e}): {body}"),
    })
}

fn network_error(e: reqwest::Error) -> UploadError {
    if e.is_timeout() {
        UploadError::Network("API did not respond — is it running?".into())
    } else if e.is_connect() {
        UploadError::Network("Can't reach the API — start it with `npm run dev:api`".into())
    } else {
        UploadError::Network(e.to_string())
    }
}

#[derive(Debug)]
pub enum UploadError {
    Network(String),
    QuotaExceeded,
    Api { status: u16, body: String },
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UploadError::Network(m) => write!(f, "{m}"),
            UploadError::QuotaExceeded => write!(
                f,
                "Free live limit reached (10). Upgrade for unlimited."
            ),
            UploadError::Api { status, body } => write!(f, "Upload failed ({status}): {body}"),
        }
    }
}
