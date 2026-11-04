//! A concurrency limit that can change while downloads are running.
//!
//! A plain semaphore has a fixed size. Raising the limit adds permits;
//! lowering it takes permits out of circulation as running downloads hand
//! them back, so nothing is interrupted and the new limit holds once enough
//! downloads finish.

use std::sync::{Arc, Mutex};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct Gate {
    semaphore: Arc<Semaphore>,
    limit: Mutex<usize>,
}

impl Gate {
    pub fn new(limit: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(limit)),
            limit: Mutex::new(limit),
        }
    }

    /// Wait for a free slot. The slot is released when the permit drops.
    pub async fn acquire(&self) -> OwnedSemaphorePermit {
        self.semaphore
            .clone()
            .acquire_owned()
            .await
            .expect("the gate's semaphore is never closed")
    }

    #[cfg(test)]
    pub fn limit(&self) -> usize {
        *self.limit.lock().unwrap()
    }

    pub fn set_limit(&self, next: usize) {
        let mut limit = self.limit.lock().unwrap();
        let current = *limit;
        *limit = next;
        if next > current {
            self.semaphore.add_permits(next - current);
        } else if next < current {
            let surplus = (current - next) as u32;
            let semaphore = self.semaphore.clone();
            tokio::spawn(async move {
                if let Ok(permits) = semaphore.acquire_many_owned(surplus).await {
                    permits.forget();
                }
            });
        }
    }

    #[cfg(test)]
    pub fn available(&self) -> usize {
        self.semaphore.available_permits()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn raising_the_limit_frees_slots_at_once() {
        let gate = Gate::new(1);
        let _held = gate.acquire().await;
        gate.set_limit(3);
        assert_eq!(gate.available(), 2);
        assert_eq!(gate.limit(), 3);
    }

    #[tokio::test]
    async fn lowering_the_limit_waits_for_running_downloads() {
        let gate = Gate::new(3);
        let first = gate.acquire().await;
        let second = gate.acquire().await;
        gate.set_limit(1);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(gate.available(), 0, "the one free slot is withdrawn");

        drop(first);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(gate.available(), 0, "still over the new limit");

        drop(second);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(gate.available(), 1);
    }
}
