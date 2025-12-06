# Documentation - CLAUDE.md

## Purpose
Project documentation including:
1. Hardware setup guides
2. Modbus register references
3. Deployment instructions
4. Troubleshooting guides

## Key Documents

### hardware_setup.md
- Raspberry Pi 5 setup instructions
- USB-RS485 adapter configuration
- Network setup
- Industrial enclosure recommendations
- Power supply requirements

### modbus_registers.md
- Sungrow inverter registers
- Meatrol ME431 meter registers
- ComAp InteliGen 500 registers (TBD)
- Register data types and scales

### deployment.md
- Controller deployment to Raspberry Pi
- Cloud platform setup (Supabase + DigitalOcean)
- SSL certificate configuration
- Backup and recovery procedures

## Hardware Reference

### Raspberry Pi 5
- Order: https://www.raspberrypi.com/products/raspberry-pi-5/
- Accessories needed:
  - Active Cooler (~$5)
  - Industrial enclosure (~$50-80)
  - USB-RS485 adapter (~$20)
  - 27W USB-C power supply

### Future Hardware (Planned)
- Elastel EG500 - Industrial-rated
- Revolution Pi RevPi - DIN rail certified

## Modbus Quick Reference

### Sungrow Inverter (SG150KTL-M)
| Register | Description | Access |
|----------|-------------|--------|
| 5007 | Power Limit Enable | Write |
| 5008 | Power Limit (%) | Write |
| 5031 | Active Power | Read |

### Meatrol ME431
| Register | Description | Units |
|----------|-------------|-------|
| 1032 | Total Active Power | W |
| 1056 | Power Factor | - |

### ComAp InteliGen 500
- Registers TBD (need ComAp documentation)
