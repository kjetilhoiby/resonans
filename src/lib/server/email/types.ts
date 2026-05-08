export interface EmailAttachment {
	name: string;
	contentType: string;
	base64: string;
	size?: number;
}

export interface EmailEnvelope {
	userId: string;
	gmailMessageId: string;
	gmailThreadId: string;
	internalDate: Date;
	from: string;
	to: string;
	subject: string;
	bodyText: string;
	label: string;
	attachments: EmailAttachment[];
}

export interface EmailHandlerResult {
	imported: number;
	failed: number;
	notes?: string[];
}

export interface EmailHandler {
	label: string;
	handle(envelope: EmailEnvelope): Promise<EmailHandlerResult>;
}
