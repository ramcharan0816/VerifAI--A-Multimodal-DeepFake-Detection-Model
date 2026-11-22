# Deploy VerifAI on an Oracle Always Free VM

This deployment keeps the Vercel frontend and runs the API on an Oracle Linux/Ubuntu VM. The Compose setup uses Docker, Caddy for HTTPS, and persistent Docker volumes for the SQLite database, uploaded media, and downloaded model files.

## 1. Create the VM and DNS

Create an Ubuntu Ampere A1 VM in Oracle Cloud, assign up to 2 OCPUs and 12 GB RAM, and reserve a public IPv4 address. Add an A record for a hostname such as `api.example.com` pointing to that address.

In the VM's Oracle Virtual Cloud Network ingress rules, allow TCP ports 22, 80, and 443. Restrict SSH (22) to your own public IP where possible. Keep outbound HTTPS available so the first audio scan can download its AASIST checkpoint.

## 2. Install Docker and clone the repo

SSH into the VM, then run:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and reconnect so the Docker group takes effect. Then clone the repository:

```bash
git clone https://github.com/ramcharan0816/VerifAI--A-Multimodal-DeepFake-Detection-Model.git verifai
cd verifai
mkdir -p backend/weights
```

## 3. Copy the image-model checkpoint

The image checkpoint is intentionally excluded from Git. From the Windows project folder, copy it to the VM (replace the key path and IP):

```powershell
scp -i "C:\path\to\oracle-ssh-key.key" -r .\backend\weights\* ubuntu@<VM_PUBLIC_IP>:~/verifai/backend/weights/
```

Confirm `backend/weights/mobilenetv3_deepfake.pth` exists on the VM before starting Compose. The app can start without it, but would initialize random weights and produce unusable image/video scores.

## 4. Configure the hostname and start services

On the VM:

```bash
cp .env.oracle.example .env
nano .env
```

Set `DOMAIN` to the DNS name whose A record points to this VM. Save the file, then build and start the API and HTTPS proxy:

```bash
docker compose up -d --build
docker compose logs -f api
```

Caddy requests and renews the HTTPS certificate automatically after DNS has propagated and ports 80/443 are reachable. Check the service:

```bash
curl https://api.example.com/api/health
```

The response should report `"status":"healthy"` and `"model_loaded":true`.

## 5. Point Vercel at the new API

In `frontend/index.html`, change the `verifai-api-origin` meta tag to the HTTPS hostname, for example:

```html
<meta name="verifai-api-origin" content="https://api.example.com">
```

Commit and push that frontend change to trigger Vercel's deployment. The backend CORS configuration already includes the production Vercel origin and also reads `VERIFAI_FRONTEND_ORIGINS` from `.env`.

## Operations

```bash
docker compose ps
docker compose logs -f api
docker compose restart api
docker compose pull caddy && docker compose up -d
```

The SQLite database and upload files persist in Docker volumes across container rebuilds. The VM must remain powered on; Oracle's Always Free capacity can be unavailable in some regions, and its policy allows reclaiming persistently idle instances.
