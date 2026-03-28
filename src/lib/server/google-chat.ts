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
