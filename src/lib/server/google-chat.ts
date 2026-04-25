/**
 * Google Chat Webhook integration
 * Send formaterte meldinger til Google Chat med lenker tilbake til appen
 */

export interface GoogleChatMessage {
	text?: string;
	cards?: GoogleChatCard[];
}

export interface GoogleChatCard {
	header?: {
		title: string;
		subtitle?: string;
		imageUrl?: string;
	};
	sections: GoogleChatSection[];
}

export interface GoogleChatSection {
	header?: string;
	widgets: GoogleChatWidget[];
}

export interface GoogleChatWidget {
	textParagraph?: { text: string };
	keyValue?: {
		topLabel?: string;
		content: string;
		contentMultiline?: boolean;
		icon?: string;
	};
	buttons?: Array<{
		textButton: {
			text: string;
			onClick: {
				openLink: {
					url: string;
				};
			};
		};
	}>;
}

export interface WorkoutImportedMessageData {
	appUrl: string;
	workoutTitle: string;
	workoutTimestamp: string;
	distanceKm?: number | null;
	durationSeconds?: number | null;
	paceSecondsPerKm?: number | null;
	elevationMeters?: number | null;
	avgHeartRate?: number | null;
	maxHeartRate?: number | null;
	sourceName?: string | null;
	healthChatUrl: string;
	healthDataUrl: string;
}

function formatWorkoutDate(timestampIso: string): string {
	return new Intl.DateTimeFormat('nb-NO', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestampIso));
}

function formatWorkoutDuration(durationSeconds?: number | null): string | null {
	if (!durationSeconds) return null;
	const totalMinutes = Math.round(durationSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0 ? `${hours} t ${minutes} min` : `${minutes} min`;
}

function formatWorkoutPace(paceSecondsPerKm?: number | null): string | null {
	if (!paceSecondsPerKm) return null;
	const minutes = Math.floor(paceSecondsPerKm / 60);
	const seconds = Math.round(paceSecondsPerKm % 60)
		.toString()
		.padStart(2, '0');
	return `${minutes}:${seconds} /km`;
}

/**
 * Send melding til Google Chat webhook
 */
export async function sendGoogleChatMessage(
	webhookUrl: string,
	message: GoogleChatMessage
): Promise<boolean> {
	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json; charset=UTF-8'
			},
			body: JSON.stringify(message)
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Google Chat webhook error:', errorText);
			return false;
		}

		return true;
	} catch (error) {
		console.error('Failed to send Google Chat message:', error);
		return false;
	}
}

/**
 * Bygg daglig check-in melding
 */
export function buildDailyCheckInMessage(data: {
	appUrl: string;
	userName?: string;
	avatarUrl?: string | null;
	goalsSummary: Array<{
		title: string;
		progress: number;
		status: string;
	}>;
	tasksDueToday: Array<{
		title: string;
		goalTitle: string;
	}>;
}): GoogleChatMessage {
	const { appUrl, userName, avatarUrl, goalsSummary, tasksDueToday } = data;

	const greeting = userName ? `Hei ${userName}!` : 'Hei!';
	const today = new Date().toLocaleDateString('no-NO', {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});

	const widgets: GoogleChatWidget[] = [
		{
			textParagraph: {
				text: `<b>${greeting}</b><br>Hvordan går det med målene dine?`
			}
		}
	];

	// Legg til goals summary
	if (goalsSummary.length > 0) {
		widgets.push({
			textParagraph: {
				text: '<b>📊 Dine mål:</b>'
			}
		});

		for (const goal of goalsSummary.slice(0, 3)) {
			// Google Chat API supports these icon values: STAR, DOLLAR, PERSON, etc.
			// We'll use text emojis in content instead
			const emoji = goal.progress >= 100 ? '✅' : goal.progress >= 50 ? '🔥' : '🎯';
			widgets.push({
				keyValue: {
					topLabel: goal.title,
					content: `${emoji} ${goal.progress}% fullført`
					// Removed icon field - not compatible with emoji
				}
			});
		}
	}

	// Legg til tasks due today
	if (tasksDueToday.length > 0) {
		widgets.push({
			textParagraph: {
				text: '<b>✅ Oppgaver i dag:</b>'
			}
		});

		for (const task of tasksDueToday.slice(0, 3)) {
			widgets.push({
				textParagraph: {
					text: `• ${task.title} <i>(${task.goalTitle})</i>`
				}
			});
		}
	} else {
		widgets.push({
			textParagraph: {
				text: '<i>Ingen spesifikke oppgaver planlagt i dag</i>'
			}
		});
	}

	// Legg til action buttons med smart context
	const contextMessage = encodeURIComponent(
		`📊 Daglig check-in: Du har ${goalsSummary.length} aktive mål. ${tasksDueToday.length > 0 ? `${tasksDueToday.length} oppgaver i dag.` : 'Ingen oppgaver planlagt i dag.'}`
	);

	widgets.push({
		buttons: [
			{
				textButton: {
					text: '📝 Logg aktivitet',
					onClick: {
						openLink: {
							url: `${appUrl}?action=log&context=${contextMessage}`
						}
					}
				}
			},
			{
				textButton: {
					text: '📊 Sjekk fremgang',
					onClick: {
						openLink: {
							url: `${appUrl}?action=check&context=${contextMessage}`
						}
					}
				}
			},
			{
				textButton: {
					text: '🎯 Se mål',
					onClick: {
						openLink: {
							url: `${appUrl}/goals`
						}
					}
				}
			}
		]
	});

	return {
		cards: [
			{
				header: {
					title: '🎯 Resonans - Daglig check-in',
					subtitle: today,
					...(avatarUrl ? { imageUrl: avatarUrl } : {})
				},
				sections: [
					{
						widgets
					}
				]
			}
		]
	};
}

export function buildDayPlanningNudgeMessage(data: {
	appUrl: string;
	userName?: string | null;
	dayIso: string;
	carryoverCount: number;
	nudgeEventId?: string;
}): GoogleChatMessage {
	const { appUrl, userName, dayIso, carryoverCount, nudgeEventId } = data;
	const greeting = userName ? `Hei ${userName}!` : 'Hei!';
	const eventParam = nudgeEventId ? `&nudgeEventId=${encodeURIComponent(nudgeEventId)}` : '';

	return {
		cards: [
			{
				header: {
					title: '🗓️ Planlegg dag',
					subtitle: dayIso
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${greeting}</b><br>Dagen er ikke planlagt ennå. Sett en enlinjer og velg dagsoppgaver.`
								}
							},
							{
								keyValue: {
									topLabel: 'Overliggere fra i går',
									content: `${carryoverCount}`
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: 'Planlegg dag nå',
											onClick: {
												openLink: {
													url: `${appUrl}/ukeplan?day=${dayIso}&nudgeTrack=plan_day${eventParam}`
												}
											}
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}

export function buildDayCloseNudgeMessage(data: {
	appUrl: string;
	userName?: string | null;
	dayIso: string;
	openItems: number;
	nudgeEventId?: string;
}): GoogleChatMessage {
	const { appUrl, userName, dayIso, openItems, nudgeEventId } = data;
	const greeting = userName ? `Hei ${userName}!` : 'Hei!';
	const eventParam = nudgeEventId ? `&nudgeEventId=${encodeURIComponent(nudgeEventId)}` : '';

	return {
		cards: [
			{
				header: {
					title: '🌙 Avslutt dag',
					subtitle: dayIso
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${greeting}</b><br>Du har fortsatt <b>${openItems}</b> åpne punkt i dag.`
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: 'Avslutt dag',
											onClick: {
												openLink: {
													url: `${appUrl}/ukeplan?day=${dayIso}&nudgeTrack=close_day${eventParam}`
												}
											}
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}

export function buildRelationshipCheckinMorningNudgeMessage(data: {
	appUrl: string;
	userName?: string | null;
	dayIso: string;
	nudgeEventId?: string;
}): GoogleChatMessage {
	const { appUrl, userName, dayIso, nudgeEventId } = data;
	const greeting = userName ? `God morgen ${userName}!` : 'God morgen!';
	const eventParam = nudgeEventId ? `&nudgeEventId=${encodeURIComponent(nudgeEventId)}` : '';

	return {
		cards: [
			{
				header: {
					title: '☀️ Morgen-check: parforhold',
					subtitle: dayIso
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${greeting}</b><br>Ta 20 sekunder og legg inn dagens parsjekk før dagen drar i gang.`
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: 'Svar på parsjekk',
											onClick: {
												openLink: {
													url: `${appUrl}/settings#profil?nudgeTrack=relationship_checkin_morning${eventParam}`
												}
											}
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}

export function buildNudgeDigestMessage(data: {
	userName?: string | null;
	dayIso: string;
	plannedItems: number;
	openItems: number;
	carryoverCount: number;
	reason: string;
}): GoogleChatMessage {
	const { userName, dayIso, plannedItems, openItems, carryoverCount, reason } = data;
	const greeting = userName ? `Hei ${userName}!` : 'Hei!';

	return {
		cards: [
			{
				header: {
					title: '🧭 Dagsoppsummering',
					subtitle: `${dayIso} · ${reason}`
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${greeting}</b><br>Vi holder det rolig nå. Her er status uten oppfordringer.`
								}
							},
							{
								keyValue: {
									topLabel: 'Planlagt i dag',
									content: `${plannedItems}`
								}
							},
							{
								keyValue: {
									topLabel: 'Åpne punkt',
									content: `${openItems}`
								}
							},
							{
								keyValue: {
									topLabel: 'Overliggere fra i går',
									content: `${carryoverCount}`
								}
							}
						]
					}
				]
			}
		]
	};
}

/**
 * Bygg milestone notification
 */
export function buildMilestoneMessage(data: {
	appUrl: string;
	goalTitle: string;
	milestone: string;
	message: string;
}): GoogleChatMessage {
	const { appUrl, goalTitle, milestone, message } = data;

	return {
		cards: [
			{
				header: {
					title: '🎉 Gratulerer!',
					subtitle: 'Du har nådd en milepæl'
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${goalTitle}</b>`
								}
							},
							{
								keyValue: {
									topLabel: 'Milepæl',
									content: `🏆 ${milestone}`
									// Removed icon field
								}
							},
							{
								textParagraph: {
									text: message
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: '💬 Fortsett',
											onClick: {
												openLink: {
													url: `${appUrl}?context=${encodeURIComponent(`🎉 Gratulerer! Du nådde ${milestone} på målet "${goalTitle}". ${message}`)}`
												}
											}
										}
									},
									{
										textButton: {
											text: '🎯 Se fremgang',
											onClick: {
												openLink: {
													url: `${appUrl}/goals`
												}
											}
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}

/**
 * Bygg reminder notification
 */
export function buildReminderMessage(data: {
	appUrl: string;
	taskTitle: string;
	goalTitle: string;
	message: string;
}): GoogleChatMessage {
	const { appUrl, taskTitle, goalTitle, message } = data;

	return {
		cards: [
			{
				header: {
					title: '⏰ Påminnelse',
					subtitle: goalTitle
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${taskTitle}</b>`
								}
							},
							{
								textParagraph: {
									text: message
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: '✅ Logg aktivitet',
											onClick: {
												openLink: {
													url: `${appUrl}?action=log&context=${encodeURIComponent(`⏰ Påminnelse: ${taskTitle} (${goalTitle}). ${message}`)}`
												}
											}
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}

export function buildWorkoutImportedMessage(data: WorkoutImportedMessageData): GoogleChatMessage {
	const widgets: GoogleChatWidget[] = [
		{
			textParagraph: {
				text: `<b>${data.workoutTitle}</b><br>${formatWorkoutDate(data.workoutTimestamp)}`
			}
		}
	];

	if (data.distanceKm != null) {
		widgets.push({
			keyValue: {
				topLabel: 'Distanse',
				content: `${data.distanceKm.toFixed(2)} km`
			}
		});
	}

	const duration = formatWorkoutDuration(data.durationSeconds);
	if (duration) {
		widgets.push({
			keyValue: {
				topLabel: 'Varighet',
				content: duration
			}
		});
	}

	const pace = formatWorkoutPace(data.paceSecondsPerKm);
	if (pace) {
		widgets.push({
			keyValue: {
				topLabel: 'Tempo',
				content: pace
			}
		});
	}

	if (data.elevationMeters != null) {
		widgets.push({
			keyValue: {
				topLabel: 'Høydemeter',
				content: `${Math.round(data.elevationMeters)} m`
			}
		});
	}

	if (data.avgHeartRate != null) {
		const maxText = data.maxHeartRate != null ? ` · maks ${Math.round(data.maxHeartRate)}` : '';
		widgets.push({
			keyValue: {
				topLabel: 'Puls',
				content: `Snitt ${Math.round(data.avgHeartRate)}${maxText}`
			}
		});
	}

	if (data.sourceName) {
		widgets.push({
			textParagraph: {
				text: `<i>Kilde: ${data.sourceName}</i>`
			}
		});
	}

	widgets.push({
		buttons: [
			{
				textButton: {
					text: '💬 Åpne i Helse-chat',
					onClick: {
						openLink: {
							url: data.healthChatUrl
						}
					}
				}
			},
			{
				textButton: {
					text: '📊 Åpne Helse',
					onClick: {
						openLink: {
							url: data.healthDataUrl
						}
					}
				}
			}
		]
	});

	return {
		cards: [
			{
				header: {
					title: '🏃 Ny treningsøkt registrert',
					subtitle: 'Dropbox-import fullført'
				},
				sections: [
					{
						widgets
					}
				]
			}
		]
	};
}

export function buildSalaryNudgeMessage(data: {
	appUrl: string;
	userName?: string | null;
	salaryAmount: number;
	totalSpending: number;
	savingsChange: number;
	spendingTrend: number;
	salaryMonth: string;
	nudgeEventId?: string | null;
}): GoogleChatMessage {
	const { appUrl, userName, salaryAmount, totalSpending, savingsChange, spendingTrend, salaryMonth, nudgeEventId } = data;
	const greeting = userName ? `Hei ${userName}!` : 'Hei!';

	const monthLabel = new Date(`${salaryMonth}-01`).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
	const fmt = (n: number) => Math.round(Math.abs(n)).toLocaleString('nb-NO');
	const trendSign = spendingTrend >= 0 ? '▲' : '▼';
	const savingsSign = savingsChange >= 0 ? '+' : '-';

	const reportUrl = nudgeEventId
		? `${appUrl}/economics/lonnsmaned?nudgeTrack=salary_received&nudgeEventId=${nudgeEventId}`
		: `${appUrl}/economics/lonnsmaned`;

	return {
		cards: [
			{
				header: {
					title: '💰 Lønn mottatt',
					subtitle: monthLabel
				},
				sections: [
					{
						widgets: [
							{
								textParagraph: {
									text: `<b>${greeting}</b><br>Lønn er registrert for ${monthLabel}.`
								}
							},
							{
								keyValue: {
									topLabel: 'Lønn inn',
									content: `kr ${fmt(salaryAmount)}`
								}
							},
							{
								keyValue: {
									topLabel: 'Forbruk hittil denne perioden',
									content: `kr ${fmt(totalSpending)}`
								}
							},
							{
								keyValue: {
									topLabel: 'Sparekonto-endring',
									content: `${savingsSign} kr ${fmt(savingsChange)}`
								}
							},
							{
								keyValue: {
									topLabel: 'Trend vs. forrige periode',
									content: `${trendSign} ${Math.abs(Math.round(spendingTrend))}%`
								}
							},
							{
								buttons: [
									{
										textButton: {
											text: 'Se lønnsrapport',
											onClick: { openLink: { url: reportUrl } }
										}
									}
								]
							}
						]
					}
				]
			}
		]
	};
}
