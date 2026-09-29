/**
 * The waiting state while the backend does slow work.
 *
 * AGENTS.md section 8: the user must never be left wondering whether anything is
 * happening, so this says plainly what is in progress. `role="status"` announces
 * it without stealing focus. The caller passes the wording, so reading a PDF and
 * generating the workbook never share the same message.
 */
type Props = {
  message: string
}

export default function ProcessingScreen({ message }: Props) {
  return (
    <p className="processing" role="status">
      {message}
    </p>
  )
}
