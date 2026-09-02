import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api"); // every route now lives under /api/... — e.g. GET /api/dashboard/summary
  app.enableCors({
    origin: [
      "http://localhost:3000",
      // Add your frontend's ngrok URL here whenever it changes
      // (free-tier ngrok URLs are random and change every restart
      // unless you're on a paid plan with a reserved domain).
      "https://<your-frontend-ngrok-id>.ngrok-free.app",
    ],
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();