import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export const CLAWHUB_URL = "https://clawhub.ai";
export const CLAWHUB_DOCS_URL = "https://docs.clawhub.ai";
export const EMAIL_PREFERENCES_URL = "https://clawhub.ai/settings";
export const APPEALS_URL = "https://appeals.openclaw.ai/";
export const CLAWHUB_LOGO_URL =
  "https://resend-attachments.s3.amazonaws.com/173346b3-ef54-4b7a-8158-23a2055fe3b3";

const fontFamily = "Helvetica, Arial, sans-serif";
const monoFamily = "'Courier New', Courier, monospace";

export type FindingCardProps = {
  kind: "warning" | "error";
  meta: string;
  message: string;
  fix?: string;
  docsUrl?: string;
};

export function ClawHubEmailLayout({
  children,
  preview,
  railLabel,
  topColor = "#e8443a",
}: {
  children: ReactNode;
  preview: string;
  railLabel?: string;
  topColor?: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#0a0a0b" }}>
        <Container style={{ width: "600px", maxWidth: "600px", padding: "32px 16px 40px" }}>
          <Section style={{ padding: "0 4px 20px" }}>
            <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td valign="middle">
                    <Brand />
                  </td>
                  {railLabel ? (
                    <td
                      align="right"
                      valign="middle"
                      style={{
                        fontFamily: monoFamily,
                        fontSize: "11px",
                        letterSpacing: "2px",
                        textTransform: "uppercase",
                        color: "#8a8a8e",
                      }}
                    >
                      {railLabel}
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </Section>
          <Section
            style={{
              height: "4px",
              fontSize: 0,
              lineHeight: 0,
              backgroundColor: topColor,
              borderRadius: "13px 13px 0 0",
            }}
          >
            &nbsp;
          </Section>
          <Section
            style={{
              backgroundColor: "#141416",
              border: "1px solid #26262a",
              borderTop: 0,
              borderRadius: "0 0 14px 14px",
              padding: "36px 36px 40px",
            }}
          >
            {children}
          </Section>
          <Footer />
        </Container>
      </Body>
    </Html>
  );
}

export function Brand() {
  return (
    <table role="presentation" cellPadding="0" cellSpacing="0">
      <tbody>
        <tr>
          <td valign="middle" style={{ paddingRight: "10px" }}>
            <Img
              src={CLAWHUB_LOGO_URL}
              width="32"
              height="32"
              alt="ClawHub"
              style={{ display: "block", border: 0, borderRadius: "8px" }}
            />
          </td>
          <td
            valign="middle"
            style={{ fontFamily, fontSize: "18px", fontWeight: "bold", color: "#f5f5f5" }}
          >
            ClawHub
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function Footer() {
  return (
    <Section style={{ textAlign: "center", padding: "28px 4px 0" }}>
      <table role="presentation" align="center" cellPadding="0" cellSpacing="0">
        <tbody>
          <tr>
            <td valign="middle" style={{ paddingRight: "8px" }}>
              <Img
                src="https://openclaw.ai/favicon.svg"
                width="18"
                height="18"
                alt="OpenClaw"
                style={{ display: "block", border: 0 }}
              />
            </td>
            <td
              valign="middle"
              style={{ fontFamily, fontSize: "13px", fontWeight: "bold", color: "#e8443a" }}
            >
              OpenClaw
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={{ margin: "8px 0 0", fontFamily, fontSize: "12px", color: "#8a8a8e" }}>
        The AI that actually does things.
      </Text>
      <Text style={{ margin: "12px 0 0", fontFamily, fontSize: "12px", color: "#5c5c60" }}>
        <Link href={CLAWHUB_URL} style={footerLinkStyle}>
          ClawHub
        </Link>
        {" . "}
        <Link href={CLAWHUB_DOCS_URL} style={footerLinkStyle}>
          Docs
        </Link>
        {" . "}
        <Link href={EMAIL_PREFERENCES_URL} style={footerLinkStyle}>
          Email preferences
        </Link>
      </Text>
    </Section>
  );
}

export function Badge({ children, color = "#e8443a" }: { children: ReactNode; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: monoFamily,
        fontSize: "11px",
        fontWeight: "bold",
        letterSpacing: "1px",
        color,
        backgroundColor: color === "#3fb950" ? "rgba(63,185,80,0.12)" : "rgba(232,68,58,0.12)",
        border: `1px solid ${color === "#3fb950" ? "rgba(63,185,80,0.35)" : "rgba(232,68,58,0.35)"}`,
        borderRadius: "6px",
        padding: "5px 10px",
      }}
    >
      {children}
    </span>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{
        margin: "20px 0 0",
        fontFamily,
        fontSize: "24px",
        lineHeight: "32px",
        fontWeight: "bold",
        color: "#f5f5f5",
      }}
    >
      {children}
    </Heading>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        margin: "14px 0 0",
        fontFamily,
        fontSize: "15px",
        lineHeight: "23px",
        color: "#a8a8ad",
      }}
    >
      {children}
    </Text>
  );
}

export function MonoPill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: monoFamily,
        fontSize: "14px",
        color: "#f5f5f5",
        backgroundColor: "#1c1c20",
        borderRadius: "4px",
        padding: "2px 6px",
      }}
    >
      {children}
    </span>
  );
}

export function DetailTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      style={{
        marginTop: "24px",
        backgroundColor: "#0e0e10",
        border: "1px solid #26262a",
        borderRadius: "10px",
      }}
    >
      <tbody>
        {rows.map(([label, value], index) => (
          <tr key={label}>
            <td
              style={{
                padding: "14px 18px",
                borderBottom: index === rows.length - 1 ? 0 : "1px solid #26262a",
                fontFamily,
                fontSize: "12px",
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: "#8a8a8e",
              }}
            >
              {label}
            </td>
            <td
              align="right"
              style={{
                padding: "14px 18px",
                borderBottom: index === rows.length - 1 ? 0 : "1px solid #26262a",
                fontFamily: monoFamily,
                fontSize: "14px",
                color: "#f5f5f5",
              }}
            >
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ActionButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ textAlign: "center", marginTop: "28px" }}>
      <Button
        href={href}
        style={{
          display: "inline-block",
          backgroundColor: "#e8443a",
          borderRadius: "8px",
          padding: "13px 32px",
          fontFamily,
          fontSize: "14px",
          fontWeight: "bold",
          color: "#ffffff",
          textDecoration: "none",
        }}
      >
        {children} →
      </Button>
    </Section>
  );
}

export function CodeBox({ children }: { children: ReactNode }) {
  return (
    <Section
      style={{
        marginTop: "12px",
        backgroundColor: "#0e0e10",
        border: "1px solid #26262a",
        borderRadius: "10px",
        padding: "14px 18px",
      }}
    >
      <code style={{ fontFamily: monoFamily, fontSize: "13px", color: "#f5f5f5" }}>
        <span style={{ color: "#e8443a" }}>$</span> {children}
      </code>
    </Section>
  );
}

export function FindingCard({ kind, meta, message, fix, docsUrl }: FindingCardProps) {
  const color = kind === "error" ? "#e8443a" : "#ffb340";
  return (
    <Section
      style={{
        backgroundColor: "#0e0e10",
        border: "1px solid #26262a",
        borderRadius: "10px",
        padding: "20px 22px",
        marginBottom: "12px",
      }}
    >
      <Text style={{ margin: "0 0 12px", fontFamily: monoFamily, fontSize: "12px" }}>
        <span style={{ fontWeight: "bold", color }}>{kind === "error" ? "ERROR" : "FINDING"}</span>
        <span style={{ color: "#5c5c60" }}> . </span>
        <span style={{ color: "#8a8a8e" }}>{meta}</span>
      </Text>
      <Text style={{ margin: "0 0 16px", fontFamily, fontSize: "15px", color: "#f5f5f5" }}>
        {message}
      </Text>
      {fix ? (
        <Text
          style={{
            margin: 0,
            borderTop: "1px solid #1c1c20",
            paddingTop: "14px",
            fontFamily,
            fontSize: "14px",
            lineHeight: "22px",
            color: "#a8a8ad",
          }}
        >
          <strong style={{ color: "#c9c9ce" }}>Fix:</strong> {fix}{" "}
          {docsUrl ? (
            <Link href={docsUrl} style={{ color: "#e8443a", textDecoration: "none" }}>
              Docs →
            </Link>
          ) : null}
        </Text>
      ) : null}
    </Section>
  );
}

export function MultilineText({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

const footerLinkStyle = {
  color: "#8a8a8e",
  textDecoration: "underline",
};
