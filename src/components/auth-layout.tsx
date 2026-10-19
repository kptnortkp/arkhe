import Image from "next/image";
import { ArkheLockup } from "@/components/arkhe-logo";
import piano from "../../public/brand/piano.webp";
import pianoKeys from "../../public/brand/piano-keys.webp";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh md:grid-cols-2">
      <section className="on-stage relative hidden overflow-hidden bg-stage text-stage-foreground md:block">
        <Image
          src={piano}
          alt=""
          fill
          priority
          sizes="(min-width: 768px) 50vw, 1px"
          className="object-cover opacity-70"
        />
        <div className="stage-scrim absolute inset-0" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <ArkheLockup className="w-64" />
          <blockquote className="max-w-md space-y-5">
            <p className="font-heading text-4xl leading-tight font-light text-balance">
              Ἀρχή: her şeyin <span className="text-brand-gradient font-normal">başladığı</span>{" "}
              yer.
            </p>
            <div className="bg-brand-gradient h-0.5 w-24 rounded-full" />
            <p className="text-sm text-stage-foreground/70">
              Arkhe Mülkiye Çoksesli Korosu · Ankara
            </p>
          </blockquote>
        </div>
      </section>

      <main className="flex flex-col">
        <div className="on-stage relative h-40 overflow-hidden rounded-b-3xl bg-stage text-stage-foreground md:hidden">
          <Image
            src={pianoKeys}
            alt=""
            fill
            priority
            sizes="(max-width: 767px) 100vw, 1px"
            className="object-cover opacity-60"
          />
          <div className="stage-scrim absolute inset-0" />
          <div className="absolute inset-x-6 bottom-5">
            <ArkheLockup className="w-48" />
          </div>
        </div>
        <div className="flex flex-1 flex-col px-6 pt-8 pb-12 md:justify-center md:px-16">
          <div className="mx-auto w-full max-w-sm space-y-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
