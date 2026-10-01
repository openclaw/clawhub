import {
  ActionButton,
  Brand,
  EMAIL_PREFERENCES_URL,
  Footer,
  MultilineText,
  Paragraph,
} from "./_components/clawhub";

export type AdminOneOffEmailProps = {
  recipientHandle?: string;
  subject: string;
  title: string;
  body: string;
  primaryAction?: {
    label: string;
    url: string;
  };
};

export default function AdminOneOffEmail({
  subject,
  title,
  body,
  primaryAction,
}: AdminOneOffEmailProps) {
  return (
    <html lang="en">
      <head>
        <title>{subject}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#0a0a0b" }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>{body}</div>
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td align="center" style={{ padding: "44px 16px" }}>
                <table role="presentation" width="600" cellPadding="0" cellSpacing="0">
                  <tbody>
                    <tr>
                      <td align="center" style={{ padding: "0 0 22px" }}>
                        <Brand />
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          backgroundColor: "#141416",
                          border: "1px solid #26262a",
                          borderRadius: "14px",
                          padding: "36px",
                        }}
                      >
                        <h1
                          style={{
                            margin: 0,
                            fontFamily: "Helvetica, Arial, sans-serif",
                            fontSize: "24px",
                            lineHeight: "32px",
                            color: "#f5f5f5",
                          }}
                        >
                          {title}
                        </h1>
                        <Paragraph>
                          <MultilineText value={body} />
                        </Paragraph>
                        {primaryAction ? (
                          <ActionButton href={primaryAction.url}>
                            {primaryAction.label}
                          </ActionButton>
                        ) : null}
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <Footer />
                        <div style={{ display: "none" }}>{EMAIL_PREFERENCES_URL}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

AdminOneOffEmail.PreviewProps = {
  recipientHandle: "octocat",
  subject: "Content rights report",
  title: "Action required: content rights report",
  body: "We received a report about <package>. Please reply with context.",
  primaryAction: {
    label: "Open appeal",
    url: "https://appeals.openclaw.ai/case-123",
  },
} satisfies AdminOneOffEmailProps;
