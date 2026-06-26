import json
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi


def get_github_oidc_token() -> str:
    request_url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    separator = "&" if "?" in request_url else "?"
    request = urllib.request.Request(
        f"{request_url}{separator}audience=https://huggingface.co",
        headers={
            "Authorization": f"bearer {os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["value"]


def exchange_hugging_face_token(oidc_token: str, resource: str) -> str:
    body = json.dumps(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
            "subject_token": oidc_token,
            "resource": resource,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://huggingface.co/oauth/token",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["access_token"]


snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
repo_id = os.environ["HF_DATASET_REPO"]
revision = os.environ["HF_REVISION"]
token = exchange_hugging_face_token(
    get_github_oidc_token(),
    os.environ["HF_OIDC_RESOURCE"],
)
api = HfApi(token=token)

manifest_path = snapshot_dir / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["huggingface_dataset"]["commit"] = None
manifest["huggingface_dataset"]["revision"] = revision
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

with tempfile.TemporaryDirectory(prefix="clawhub-hf-upload-") as staging_root:
    staging_dir = Path(staging_root)
    shutil.copytree(
        snapshot_dir / "hf-dataset" / "data",
        staging_dir / "data",
    )
    (staging_dir / "metadata").mkdir()
    shutil.copy2(
        manifest_path,
        staging_dir / "metadata" / "latest-manifest.json",
    )
    commit = api.upload_folder(
        folder_path=str(staging_dir),
        path_in_repo="",
        repo_id=repo_id,
        repo_type="dataset",
        revision=revision,
        delete_patterns="data/*.jsonl",
        commit_message="Update nightly ClawHub security dataset and manifest",
    )

print(
    json.dumps(
        {
            "commit": commit.oid,
            "repo": repo_id,
            "revision": revision,
        },
        indent=2,
    )
)
