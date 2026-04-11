import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

type PartnerInviteEmailInput = {
	toEmail: string;
	inviterName: string;
	inviterEmail: string;
	inviteToken: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;

function hasSmtpConfig() {
	return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

function getTransporter() {
	if (cachedTransporter) return cachedTransporter;

	const smtpPort = Number.parseInt(env.SMTP_PORT || '587', 10);
	const smtpSecure = env.SMTP_SECURE === 'true' || env.SMTP_SECURE === '1';

	cachedTransporter = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: Number.isFinite(smtpPort) ? smtpPort : 587,
		secure: smtpSecure,
		auth: {
			user: env.SMTP_USER,
			pass: env.SMTP_PASS
		}
	});

	return cachedTransporter;
}

export async function sendPartnerInviteEmail(input: PartnerInviteEmailInput): Promise<boolean> {
	if (!hasSmtpConfig()) {
		console.warn('SMTP is not configured. Skipping partner invitation email.');
		return false;
	}

	const appUrl = env.ORIGIN || 'https://resonans.vercel.app';
	const settingsUrl = `${appUrl}/settings`;
	const inviteInfo = `Invitasjons-ID: ${input.inviteToken}`;

	try {
		await getTransporter().sendMail({
			from: env.SMTP_FROM,
			to: input.toEmail,
			subject: `${input.inviterName} inviterte deg i Resonans`,
			text: [
				`Hei!`,
				'',
				`${input.inviterName} (${input.inviterEmail}) har sendt deg en partnerinvitasjon i Resonans.`,
				'For å godta invitasjonen: logg inn med samme e-postadresse og åpne Innstillinger.',
				`Åpne appen: ${settingsUrl}`,
				inviteInfo,
				'',
				'Vennlig hilsen',
				'Resonans'
			].join('\n'),
			html: `
				<p>Hei!</p>
				<p><strong>${input.inviterName}</strong> (${input.inviterEmail}) har sendt deg en partnerinvitasjon i Resonans.</p>
				<p>For å godta invitasjonen: logg inn med samme e-postadresse og åpne Innstillinger.</p>
				<p><a href="${settingsUrl}">Åpne appen</a></p>
				<p style="color:#6b7280;font-size:12px;">${inviteInfo}</p>
				<p>Vennlig hilsen<br/>Resonans</p>
			`
		});

		return true;
	} catch (error) {
		console.error('Failed to send partner invitation email:', error);
		return false;
	}
}
