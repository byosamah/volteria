# Volteria Controller Setup Guide

Quick setup guide for installing the Volteria controller on a Raspberry Pi.

## Requirements

- **Hardware**: Raspberry Pi 5 (recommended) or Pi 4
- **OS**: Raspberry Pi OS Lite (64-bit)
- **Storage**: 16GB+ SD card
- **Network**: Ethernet (recommended) or WiFi

## Quick Start

### Step 1: Flash Raspberry Pi OS

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Select **Raspberry Pi OS Lite (64-bit)**
3. Click the gear icon to configure:
   - Set hostname: `volteria`
   - Enable SSH
   - Set username/password
   - Configure WiFi (optional)
4. Flash to SD card

### Step 2: Boot and Connect

1. Insert SD card into Raspberry Pi
2. Connect Ethernet cable (recommended)
3. Power on
4. Connect via SSH:
   ```bash
   ssh pi@volteria.local
   ```

### Step 3: Run Setup Script

Run this one-line command:

```bash
curl -sSL https://github.com/byosamah/volteria/releases/download/v1.0.0-controller/setup-controller.sh | bash
```

This installs:
- Python 3.11 with dependencies
- Volteria controller software
- Systemd service for auto-start

### Step 4: Configure

Edit the configuration file:

```bash
sudo nano /etc/volteria/config.yaml
```

Update these sections:
- `controller.id` - Your controller ID from the dashboard
- `cloud.supabase_url` - Your Supabase URL
- `cloud.supabase_key` - Your Supabase service key
- `devices` - Your Modbus device addresses

### Step 5: Start Service

```bash
sudo systemctl start volteria-controller
```

Check status:
```bash
sudo systemctl status volteria-controller
```

View logs:
```bash
journalctl -u volteria-controller -f
```

## Troubleshooting

### Service won't start

Check logs for errors:
```bash
journalctl -u volteria-controller --no-pager -n 50
```

Common issues:
- Invalid config.yaml syntax
- Missing Supabase credentials
- Network connectivity issues

### Can't connect to devices

1. Check device IP addresses in config.yaml
2. Verify devices are on same network
3. Test Modbus connection manually:
   ```bash
   /opt/volteria/venv/bin/python -c "from pymodbus.client import ModbusTcpClient; c = ModbusTcpClient('DEVICE_IP'); print(c.connect())"
   ```

### Update controller software

```bash
cd /opt/volteria/repo
sudo -u volteria git pull
sudo systemctl restart volteria-controller
```

## Directory Structure

```
/opt/volteria/
├── repo/              # Git repository
├── controller/        # Symlink to repo/controller
└── venv/              # Python virtual environment

/etc/volteria/
└── config.yaml        # Configuration file

/data/
└── controller.db      # Local SQLite database (created on first run)
```

## Support

- Documentation: https://github.com/byosamah/volteria
- Issues: https://github.com/byosamah/volteria/issues
