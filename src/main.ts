import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
 
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
    app.enableCors({
    origin: [
      "http://localhost:3000",
      // Add your frontend's ngrok URL here whenever it changes
      // (free-tier ngrok URLs are random and change every restart
      // unless you're on a paid plan with a reserved domain).
      "https://8f90-2001-44c8-418a-922a-2d19-138b-42c-e9e2.ngrok-free.app",
    ],
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
