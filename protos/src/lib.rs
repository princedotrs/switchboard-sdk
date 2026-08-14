pub mod oracle_job {
    include!(concat!(env!("OUT_DIR"), "/oracle_job.rs"));
}

pub use oracle_job::*;

pub mod oracle_job_serde {
    use crate::oracle_job::*;
    include!(concat!(env!("OUT_DIR"), "/oracle_job.serde.rs"));
}
