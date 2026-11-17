import type { MailMessage } from './providers';

/** Plain text on purpose: nothing a user typed (such as their name) is ever interpreted as markup. */
export function otpMessage(to: string, code: string, minutes: number): MailMessage {
  return {
    to,
    subject: 'Your AthleteVerse verification code',
    text:
      `Your AthleteVerse verification code is ${code}\n\n` +
      `It expires in ${minutes} minutes and can be used once. If you did not create an account, ignore this e-mail.`,
  };
}

export interface BookingMailInfo {
  code: string;
  venueName: string;
  venueAddress: string;
  courtName: string;
  dateText: string; // "Tuesday, 15 January 2030"
  timeText: string; // "18:00 to 20:00"
  totalText: string; // "60"
  freeCancelHours: number;
}

/** FR-5.15: the booking confirmation. Plain text, like every e-mail here: nothing a user typed is ever interpreted as markup. */
export function bookingConfirmedMessage(to: string, b: BookingMailInfo): MailMessage {
  return {
    to,
    subject: `Your AthleteVerse booking ${b.code}`,
    text:
      `Your booking is confirmed.\n\n` +
      `Booking code: ${b.code}\n` +
      `${b.venueName}, ${b.venueAddress}\n` +
      `${b.courtName}\n` +
      `${b.dateText}, ${b.timeText}\n` +
      `Price: ${b.totalText}\n\n` +
      `Pay cash at the venue after the match. Nothing is paid online.\n` +
      `Cancel more than ${b.freeCancelHours} hours before the start and it costs nothing. Later cancellations and no-shows reduce your credit score.`,
  };
}
