/*
# Remove withdrawal fee language

1. Updated table
- `withdrawal_requests.review_message`: existing user-facing review text is changed to explain support review without mentioning fees or payments.

2. Data changes
- Existing withdrawal requests that contain the previous fee or payment wording are updated to the neutral support-review message.
- No withdrawal requests are deleted and no amounts or statuses are changed.

3. Security
- Existing row-level security, ownership rules, approval statuses, and client write restrictions remain unchanged.

4. Important notes
- Withdrawal requests continue to be saved as pending and can be reviewed by support or administrators.
- This change removes all processing-fee requirements and fee confirmation language from stored request messaging.
*/

ALTER TABLE public.withdrawal_requests
  ALTER COLUMN review_message SET DEFAULT 'Support review is required before completion.';

UPDATE public.withdrawal_requests
SET review_message = 'Support review is required before completion.'
WHERE review_message ILIKE '%fee%'
   OR review_message ILIKE '%payment%';
