use serde::Deserialize;

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
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("X-HauntShot-Device-Id", device_id)
        .header("Content-Type", "image/png")
        .body(png)
        .send()
        .await
        .map_err(|e| UploadError::Network(e.to_string()))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| UploadError::Network(e.to_string()))?;

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
