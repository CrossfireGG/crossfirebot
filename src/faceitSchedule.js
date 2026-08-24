export async function scheduleFaceitMatch(config, matchId, scheduledAt, timezone) {
  if (!config.faceitScheduleEndpoint) {
    return {
      skipped: true,
      reason: 'FACEIT_SCHEDULE_ENDPOINT is not configured'
    };
  }

  const response = await fetch(config.faceitScheduleEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.faceitApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      match_id: matchId,
      scheduled_at: scheduledAt,
      timezone
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FACEIT schedule update failed: ${response.status} ${text}`);
  }

  return {
    skipped: false,
    data: await response.json().catch(() => ({}))
  };
}
