#!/bin/bash
# ===========================================
# Solar Diesel Controller - Server Setup Script
# ===========================================
# Run this on a fresh Ubuntu 22.04 DigitalOcean Droplet
# Usage: chmod +x setup-server.sh && sudo ./setup-server.sh
# ===========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================"
echo "Solar Diesel Controller - Server Setup"
echo -e "========================================${NC}"

# ===========================================
# Configuration
# ===========================================
DOMAIN="volteria.org"  # Your domain
EMAIL="admin@volteria.org"  # For Let's Encrypt SSL certificate
REPO_URL="https://github.com/byosamah/volteria.git"  # Your GitHub repo
APP_DIR="/opt/solar-diesel-controller"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Domain: $DOMAIN"
echo "  Email: $EMAIL"
echo "  App Directory: $APP_DIR"
echo ""

# ===========================================
# Step 1: Update System
# ===========================================
echo -e "${GREEN}[1/8] Updating system packages...${NC}"
apt-get update && apt-get upgrade -y

# ===========================================
# Step 2: Install Docker
# ===========================================
echo -e "${GREEN}[2/8] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh

    # Add current user to docker group
    usermod -aG docker $USER
else
    echo "Docker already installed"
fi

# ===========================================
# Step 3: Install Docker Compose
# ===========================================
echo -e "${GREEN}[3/8] Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed"
fi

# ===========================================
# Step 4: Install Certbot
# ===========================================
echo -e "${GREEN}[4/8] Installing Certbot...${NC}"
apt-get install -y certbot

# ===========================================
# Step 5: Clone Repository
# ===========================================
echo -e "${GREEN}[5/8] Cloning repository...${NC}"
if [ -d "$APP_DIR" ]; then
    echo "Updating existing repository..."
    cd $APP_DIR
    git pull origin main
else
    git clone $REPO_URL $APP_DIR
    cd $APP_DIR
fi

# ===========================================
# Step 6: Create Environment Files
# ===========================================
echo -e "${GREEN}[6/8] Setting up environment files...${NC}"

# Check if .env exists
if [ ! -f "$APP_DIR/.env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cat > $APP_DIR/.env << EOF
# Supabase Configuration
# Get these from your Supabase project settings
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Environment
ENVIRONMENT=production
EOF
    echo -e "${RED}IMPORTANT: Edit $APP_DIR/.env with your Supabase credentials${NC}"
fi

# ===========================================
# Step 7: Setup SSL Certificates
# ===========================================
echo -e "${GREEN}[7/8] Setting up SSL certificates...${NC}"

# Create directories
mkdir -p $APP_DIR/deploy/ssl
mkdir -p $APP_DIR/deploy/certbot/www

# Get SSL certificate (standalone mode first, then switch to webroot)
if [ ! -f "$APP_DIR/deploy/ssl/fullchain.pem" ]; then
    echo "Obtaining SSL certificate..."

    # Stop any services using port 80
    systemctl stop nginx 2>/dev/null || true

    # Get certificate
    certbot certonly --standalone \
        -d $DOMAIN \
        --email $EMAIL \
        --agree-tos \
        --non-interactive

    # Copy certificates to app directory
    cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/deploy/ssl/
    cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $APP_DIR/deploy/ssl/
else
    echo "SSL certificates already exist"
fi

# ===========================================
# Step 8: Start Application
# ===========================================
echo -e "${GREEN}[8/8] Starting application...${NC}"

cd $APP_DIR

# Update domain in nginx.conf
sed -i "s/app.yourdomain.com/$DOMAIN/g" deploy/nginx.conf

# Build and start containers
docker-compose up -d --build

# ===========================================
# Setup Auto-Renewal for SSL
# ===========================================
echo -e "${GREEN}Setting up SSL auto-renewal...${NC}"

# Create renewal script
cat > /etc/cron.monthly/renew-ssl << EOF
#!/bin/bash
certbot renew --quiet
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/deploy/ssl/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $APP_DIR/deploy/ssl/
docker-compose -f $APP_DIR/docker-compose.yml restart nginx
EOF

chmod +x /etc/cron.monthly/renew-ssl

# ===========================================
# Setup Firewall
# ===========================================
echo -e "${GREEN}Configuring firewall...${NC}"
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

# ===========================================
# Done!
# ===========================================
echo ""
echo -e "${GREEN}========================================"
echo "Setup Complete!"
echo -e "========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Edit $APP_DIR/.env with your Supabase credentials"
echo "2. Run: cd $APP_DIR && docker-compose up -d --build"
echo "3. Access your app at: https://$DOMAIN"
echo ""
echo "Useful commands:"
echo "  View logs:     docker-compose -f $APP_DIR/docker-compose.yml logs -f"
echo "  Restart:       docker-compose -f $APP_DIR/docker-compose.yml restart"
echo "  Stop:          docker-compose -f $APP_DIR/docker-compose.yml down"
echo "  Update:        cd $APP_DIR && git pull && docker-compose up -d --build"
echo ""
