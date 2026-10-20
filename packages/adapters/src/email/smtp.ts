import nodemailer from 'nodemailer'

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>
}

export function createSmtpEmailSender(config: { host: string; port: number }): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  })

  return {
    async sendLoginCode(email, code) {
      await transport.sendMail({
        from: 'Trippy <no-reply@trippy.local>',
        to: email,
        subject: 'Seu código de acesso ao Trippy',
        text: `Seu código de acesso ao Trippy é ${code}. Ele expira em 10 minutos.`,
      })
    },
  }
}
