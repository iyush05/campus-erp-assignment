declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    CAMPUS_BOOTSTRAP_OWNER_ID?: string;
    CAMPUS_JOB_TOKEN?: string;
    CAMPUS_JOB_ACTOR_ID?: string;
    CAMPUS_AI_ENDPOINT?: string;
    CAMPUS_AI_TOKEN?: string;
    CAMPUS_AI_MODEL?: string;
    BUCKET?: R2Bucket;
  }
}
