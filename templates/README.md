# Place your master PowerPoint template here as:
#   master_template.pptx
#
# The PPT generator will:
#   1. Open this file as a ZIP archive
#   2. Scan all slide XMLs for {{PLACEHOLDER}} tokens
#   3. Replace them with validated data values
#   4. Save the result to reports/job_<id>/Generated_QBR_<timestamp>.pptx
#
# If this file does not exist, a programmatic PPT will be generated instead.
#
# Supported placeholder tokens:
#   {{CUSTOMER_NAME}}         Customer name from Metadata sheet
#   {{REPORTING_PERIOD}}      Reporting period from Metadata sheet
#   {{TOTAL_SITES}}           Count of sites
#   {{TOTAL_DEVICES}}         Count of devices
#   {{TOTAL_SWITCHES}}        Count of switch-type devices
#   {{TOTAL_APS}}             Count of AP-type devices
#   {{TOTAL_ROUTERS}}         Count of router-type devices
#   {{OVERALL_UPTIME}}        Weighted average uptime %
#   {{INCIDENT_FREE_PERCENT}} % of devices with no incidents
#   {{TOTAL_INCIDENTS}}       Total incident count
#   {{SLA_COMPLIANCE}}        % of devices meeting SLA target
#   {{HEALTH_SCORE}}          Calculated health score
#   {{HEALTH_LABEL}}          Excellent / Good / Fair / Poor
#   {{TOP_RCA}}               Top root cause (tie-aware)
