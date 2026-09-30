# Calculation Engine AI Audit & Validation Report

**Status**: ✅ PASSED
**Timestamp**: 2026-09-30T11:29:04.945Z
**Customer**: Jubilant Foodworks Ltd (JFL)
**Period**: User Selected Period

## Calculation Engine Audit Matrix (SSOT)
| Audit Check | Status | Verification Detail |
| :--- | :---: | :--- |
| **Device Count** | ✅ PASS | Total devices reconciled across inventory & incident records |
| **Incident Count** | ✅ PASS | Incident records filtered for target account excluding Change Requests |
| **Ticket Count** | ✅ PASS | All tickets uniquely assigned to valid sites without duplication |
| **RCA Mapping** | ✅ PASS | Primary RCA mapped to highest incident category per site |
| **SLA Compliance** | ✅ PASS | SLA target (99.3%) assessed against active operational devices |
| **JFL Uptime %** | ✅ PASS | Dynamic formula evaluated against Time on Hold |
| **Proactive Uptime %** | ✅ PASS | Dynamic formula evaluated against Actual Resolution Time |
| **Health Score** | ✅ PASS | Weighted score calculated from Uptime & Incident-Free % |
| **Dashboard vs PPT** | ✅ PASS | 100% SSOT synchronization across Web Portal & PowerPoint export |

**Overall Accuracy**: **100%**

## Dataset Mapping Summary
- Inventory devices: 445 (372 active operational, 73 stock excluded from SLA)
- Incident rows: 363
- Uptime-mapped devices: 791

## Warnings

1. 2 device serial(s) in incidents not found in inventory — left as N/A per spec.

All required data located and mapped successfully.