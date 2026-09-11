import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv
import google.auth
from google import genai
from google.genai import types
from google.genai.errors import APIError
from google.oauth2 import service_account

# Tải các biến môi trường từ file .env
load_dotenv()


def find_service_account_file():
    """Tự động tìm file JSON Service Account nếu có."""
    sa_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("VERTEX_SERVICE_ACCOUNT_JSON")
    if sa_env and os.path.isfile(sa_env):
        return os.path.abspath(sa_env)

    current_dir = Path(__file__).parent
    for json_file in current_dir.glob("*.json"):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("type") == "service_account" and "project_id" in data:
                    return str(json_file.resolve())
        except Exception:
            continue
    return None


def init_vertex_client():
    """
    Khởi tạo kết nối 100% tới Google Cloud Vertex AI API:
    - Cách 1: Dùng file Service Account JSON (nếu có trong thư mục).
    - Cách 2: Dùng Application Default Credentials (ADC) khi bị chặn tạo file JSON key.
    """
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")

    print("=" * 65)
    print("  KẾT NỐI GOOGLE CLOUD VERTEX AI API (aiplatform.googleapis.com)")
    print("=" * 65)

    # 1. Kiểm tra nếu có file JSON Service Account
    sa_file = find_service_account_file()
    if sa_file:
        try:
            with open(sa_file, "r", encoding="utf-8") as f:
                sa_data = json.load(f)
            project_id = project_id or sa_data.get("project_id")
            client_email = sa_data.get("client_email")

            print("✅ Đã tìm thấy Service Account Key:")
            print(f"  • File Key      : {Path(sa_file).name}")
            print(f"  • GCP Project   : {project_id}")
            print(f"  • Service Email : {client_email}")
            print(f"  • Vùng Vertex AI: {location}")
            print("=" * 65)

            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_file
            creds = service_account.Credentials.from_service_account_file(
                sa_file,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            return genai.Client(
                vertexai=True,
                project=project_id,
                location=location,
                credentials=creds,
            ), project_id
        except Exception as e:
            print(f"⚠️ Không thể đọc file key {sa_file}: {e}")

    # 2. Thử dùng Application Default Credentials (ADC)
    try:
        credentials, default_project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        resolved_project = project_id or default_project

        if resolved_project:
            print("✅ Đang kết nối Vertex AI qua Google Cloud Credentials (ADC):")
            print(f"  • GCP Project   : {resolved_project}")
            print(f"  • Vùng Vertex AI: {location}")
            print(f"  • Phương thức   : Application Default Credentials (ADC)")
            print("=" * 65)

            return genai.Client(
                vertexai=True,
                project=resolved_project,
                location=location,
                credentials=credentials,
            ), resolved_project
    except Exception:
        pass

    # Nếu cả 2 cách đều chưa có
    print("\n❌ [CHƯA CÓ THÔNG TIN XÁC THỰC VERTEX AI]")
    print("Vì Google Cloud chặn tạo file JSON key bằng chính sách bảo mật,")
    print("bạn hãy chọn 1 trong 2 giải pháp sau:")
    print("-----------------------------------------------------------------")
    print("CÁCH A: Tắt chính sách bảo mật để tải file JSON key:")
    print("  1. Mở link: https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountKeyCreation")
    print("  2. Bấm 'Manage Policy' -> Chọn 'Override parent policy' -> Rules chọn 'Off' -> Save.")
    print("  3. Quay lại tạo file JSON key và thả vào thư mục này.")
    print("-----------------------------------------------------------------")
    print("CÁCH B: Đăng nhập ADC trực tiếp (KHÔNG CẦN TẢI FILE JSON KEY):")
    print("  Mở terminal và gõ lệnh sau để xác thực bằng tài khoản Google:")
    print("    gcloud auth application-default login")
    print("=================================================================\n")
    sys.exit(1)


def test_call_vertex_ai(client: genai.Client, project_id: str, prompt: str):
    """Gửi yêu cầu tới model trên Google Cloud Vertex AI."""
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    print(f"\n🚀 Đang gửi request tới Vertex AI API...")
    print(f"• Model  : {model_name}")
    print(f"• Prompt : \"{prompt}\"\n")
    print("-" * 65)

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
            ),
        )

        print("💬 PHẢN HỒI TỪ VERTEX AI:")
        print(response.text)
        print("-" * 65)

        if hasattr(response, "usage_metadata") and response.usage_metadata:
            meta = response.usage_metadata
            print("📊 THỐNG KÊ TOKEN (VERTEX AI):")
            print(f"  • Input tokens  : {getattr(meta, 'prompt_token_count', 'N/A')}")
            print(f"  • Output tokens : {getattr(meta, 'candidates_token_count', 'N/A')}")
            print(f"  • Total tokens  : {getattr(meta, 'total_token_count', 'N/A')}")
            print("-" * 65)

        return response

    except APIError as e:
        print(f"\n❌ [LỖI VERTEX AI API] Mã lỗi {e.code}: {e.message}")
        print("\n💡 Gợi ý kiểm tra:")
        if e.code == 404:
            print(f"  - Model '{model_name}' chưa có ở vùng '{os.getenv('GOOGLE_CLOUD_LOCATION', 'us-central1')}'.")
            print("  - Thử đổi sang model: gemini-2.5-flash hoặc gemini-1.5-flash")
        elif e.code == 403:
            print("  - Tài khoản của bạn chưa được gán role 'Vertex AI User' trên Google Cloud Project.")
            print("  - Hãy vào https://console.cloud.google.com/iam-admin/iam để kiểm tra quyền.")
        print("-" * 65)
        return None
    except Exception as e:
        print(f"\n❌ [LỖI HỆ THỐNG] {type(e).__name__}: {e}")
        print("-" * 65)
        return None


def main():
    client, project_id = init_vertex_client()

    prompt = "Xin chào! Bạn là AI model nào trên Google Cloud Vertex AI? Hãy giới thiệu bản thân trong 2 câu."
    if len(sys.argv) > 1:
        prompt = " ".join(sys.argv[1:])

    test_call_vertex_ai(client=client, project_id=project_id, prompt=prompt)


if __name__ == "__main__":
    main()
