"""Email delivery: SMTP when configured, structured console log otherwise (dev)."""

import logging
import smtplib
from email.mime.text import MIMEText

from app.core.config import get_settings

logger = logging.getLogger("depo.email")


def send_email(to: str, subject: str, body: str) -> bool:
    settings = get_settings()
    if not settings.smtp_host:
        logger.info(
            "[EMAIL console-fallback] to=%s subject=%r body=%r", to, subject, body[:500]
        )
        print(f"[EMAIL console-fallback] to={to} subject={subject!r}\n{body}")
        return True

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_from, [to], msg.as_string())
        return True
    except Exception:
        logger.exception("SMTP send failed (to=%s)", to)
        return False
