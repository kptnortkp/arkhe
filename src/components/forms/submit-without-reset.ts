import { startTransition, type FormEvent } from "react";

/**
 * Submits to a useActionState action without React's automatic form reset, which would
 * untick controlled checkboxes and radios in the DOM while their state stays ticked.
 */
export function submitWithoutReset(
  event: FormEvent<HTMLFormElement>,
  action: (formData: FormData) => void,
) {
  event.preventDefault();
  // Keep the clicked button's name/value, as a native submit would.
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  const formData = new FormData(event.currentTarget, submitter);
  startTransition(() => action(formData));
}
