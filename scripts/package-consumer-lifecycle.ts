export async function verifyAndReleaseConsumers<T>(
  consumers: readonly T[],
  verify: (consumer: T) => Promise<void>,
  release: (consumer: T) => Promise<void>,
): Promise<void> {
  for (const consumer of consumers) {
    await verify(consumer);
    await release(consumer);
  }
}
